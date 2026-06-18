import type { AIProvider } from '../provider'
import type { PullRequestDiff, AIFinding, ReviewSummary, ReviewContext } from '../types'

// Deterministic rules-based AI provider for local development — no API calls
export class MockAIProvider implements AIProvider {
  async healthCheck(): Promise<boolean> {
    return true
  }

  async analyzeSecurity(diff: PullRequestDiff): Promise<AIFinding[]> {
    const findings: AIFinding[] = []

    for (const file of diff.files) {
      const lines = file.patch.split('\n')

      lines.forEach((line, idx) => {
        const lineNum = idx + 1
        const added = line.startsWith('+') && !line.startsWith('+++')
        if (!added) return

        // SQL Injection: string concatenation in query calls
        if (/query\s*\([^)]*\+/.test(line) || /execute\s*\([^)]*\$\{/.test(line) || /`SELECT.*\$\{/.test(line)) {
          findings.push({
            category: 'SECURITY',
            severity: 'CRITICAL',
            title: 'SQL Injection',
            description: 'User-controlled input is concatenated directly into a SQL query string.',
            suggestion: 'Use parameterised queries or a query builder — never concatenate user input into SQL.',
            filePath: file.path,
            lineStart: lineNum,
            confidence: 0.95,
          })
        }

        // Hardcoded secrets: passwords, API keys, tokens in assignment
        if (/(?:password|secret|api_?key|token|private_?key)\s*[:=]\s*['"][^'"]{6,}/i.test(line)) {
          findings.push({
            category: 'SECURITY',
            severity: 'HIGH',
            title: 'Hardcoded Secret',
            description: 'A secret, password, or API key appears to be hardcoded in source code.',
            suggestion: 'Move secrets to environment variables and access them via process.env. Use a secrets manager in production.',
            filePath: file.path,
            lineStart: lineNum,
            confidence: 0.90,
          })
        }

        // Command injection: exec/spawn with template literals
        if (/(?:exec|spawn|execSync)\s*\([`'"][^)]*\$\{/.test(line)) {
          findings.push({
            category: 'SECURITY',
            severity: 'CRITICAL',
            title: 'Command Injection',
            description: 'User-controlled data is interpolated into a shell command string.',
            suggestion: 'Use execFile with a separate args array instead of exec with string interpolation.',
            filePath: file.path,
            lineStart: lineNum,
            confidence: 0.92,
          })
        }

        // Path traversal: user input used in file paths
        if (/readFile[^)]*req\.(params|query|body)/.test(line) || /join\([^)]*req\.(params|query|body)/.test(line)) {
          findings.push({
            category: 'SECURITY',
            severity: 'HIGH',
            title: 'Path Traversal',
            description: 'Request input is used in a file path without sanitisation.',
            suggestion: 'Validate and sanitise file paths. Use path.resolve() and verify the result stays within the allowed directory.',
            filePath: file.path,
            lineStart: lineNum,
            confidence: 0.88,
          })
        }
      })
    }

    return findings
  }

  async analyzeCodeSmells(diff: PullRequestDiff): Promise<AIFinding[]> {
    const findings: AIFinding[] = []

    for (const file of diff.files) {
      const addedLines = file.patch
        .split('\n')
        .filter(l => l.startsWith('+') && !l.startsWith('+++'))

      // Long function: count consecutive added lines with function body indentation
      const functionBlocks = this.detectLongFunctions(addedLines, file.path)
      findings.push(...functionBlocks)

      addedLines.forEach((line, idx) => {
        const lineNum = idx + 1

        // Magic numbers
        if (/=\s*\d{3,}(?!\s*[,\]})])/.test(line) && !/\/\//.test(line)) {
          findings.push({
            category: 'CODE_SMELL',
            severity: 'LOW',
            title: 'Magic Number',
            description: 'A large numeric literal is used without an explanatory named constant.',
            suggestion: 'Extract the value into a named constant: `const MAX_RETRY_ATTEMPTS = 300`.',
            filePath: file.path,
            lineStart: lineNum,
            confidence: 0.75,
          })
        }

        // TODO/FIXME comments left in code
        if (/^\+\s*\/\/\s*(TODO|FIXME|HACK|XXX)/.test(line)) {
          findings.push({
            category: 'CODE_SMELL',
            severity: 'INFO',
            title: 'Unresolved TODO Comment',
            description: 'A TODO or FIXME comment was left in the code.',
            suggestion: 'Resolve the TODO or create a tracked issue before merging.',
            filePath: file.path,
            lineStart: lineNum,
            confidence: 0.72,
          })
        }

        // console.log left in production code
        if (/console\.(log|warn|error|debug)\(/.test(line) && !file.path.includes('test') && !file.path.includes('spec')) {
          findings.push({
            category: 'CODE_SMELL',
            severity: 'LOW',
            title: 'Console Logging in Production Code',
            description: 'console.log (or similar) left in non-test code.',
            suggestion: 'Replace with the structured logger: `logger.info(...)` or `logger.error(...)`.',
            filePath: file.path,
            lineStart: lineNum,
            confidence: 0.80,
          })
        }
      })
    }

    return findings
  }

  async generateSummary(
    findings: AIFinding[],
    _diff: PullRequestDiff,
    _context: ReviewContext
  ): Promise<ReviewSummary> {
    const critical = findings.filter(f => f.severity === 'CRITICAL').length
    const high = findings.filter(f => f.severity === 'HIGH').length
    const secFindings = findings.filter(f => f.category === 'SECURITY').length

    // Score: start at 100, penalise per finding
    const securityScore = Math.max(0, 100 - critical * 20 - high * 10 - secFindings * 5)
    const qualityScore = Math.max(
      0,
      100 - findings.filter(f => f.category === 'CODE_SMELL').length * 5
    )

    const actions: string[] = []
    if (critical > 0) actions.push(`Fix ${critical} critical security issue${critical > 1 ? 's' : ''} before merging`)
    if (high > 0) actions.push(`Address ${high} high-severity finding${high > 1 ? 's' : ''}`)
    if (findings.some(f => f.title === 'SQL Injection')) actions.push('Replace all SQL string concatenation with parameterised queries')
    if (findings.some(f => f.title === 'Hardcoded Secret')) actions.push('Rotate any exposed credentials and move to environment variables')
    if (findings.some(f => f.title.includes('Long Function'))) actions.push('Break down long functions into smaller, single-responsibility units')
    if (actions.length === 0) actions.push('No critical issues found — good work!')

    return { securityScore, qualityScore, recommendedActions: actions.slice(0, 5) }
  }

  private detectLongFunctions(addedLines: string[], filePath: string): AIFinding[] {
    const findings: AIFinding[] = []
    let blockStart = -1
    let blockDepth = 0

    addedLines.forEach((line, idx) => {
      const stripped = line.slice(1) // remove '+'
      if (/(?:function\s+\w+|=>\s*\{|async\s+\w+\s*\()/.test(stripped)) {
        blockStart = idx + 1
        blockDepth = 0
      }
      blockDepth += (stripped.match(/\{/g) ?? []).length
      blockDepth -= (stripped.match(/\}/g) ?? []).length

      if (blockStart > 0 && blockDepth <= 0 && idx + 1 - blockStart > 40) {
        findings.push({
          category: 'CODE_SMELL',
          severity: 'MEDIUM',
          title: 'Long Function',
          description: `Function starting at line ${blockStart} spans ${idx + 1 - blockStart} lines, exceeding the 40-line guideline.`,
          suggestion: 'Extract logical sub-steps into well-named helper functions to improve readability and testability.',
          filePath,
          lineStart: blockStart,
          lineEnd: idx + 1,
          confidence: 0.85,
        })
        blockStart = -1
      }
    })

    return findings
  }
}
