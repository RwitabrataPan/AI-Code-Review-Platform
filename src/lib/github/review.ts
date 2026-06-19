import { Octokit } from '@octokit/rest'
import type { AIFinding, ReviewSummary } from '@/lib/ai/types'

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: '🚨', HIGH: '⚠️', MEDIUM: '🔶', LOW: '🔵', INFO: 'ℹ️',
}

function formatFindingBody(finding: AIFinding): string {
  const emoji = SEVERITY_EMOJI[finding.severity]
  return `${emoji} **[${finding.severity} — ${finding.category.replace('_', ' ')}]** ${finding.title}

${finding.description}

**Suggested fix:** ${finding.suggestion}

*Confidence: ${Math.round(finding.confidence * 100)}%*`
}

function formatSummaryBody(summary: ReviewSummary, findings: AIFinding[], truncated: boolean): string {
  const bySeverity = (s: string) => findings.filter(f => f.severity === s).length
  const byCategory = (c: string) => findings.filter(f => f.category === c)

  const secFindings = byCategory('SECURITY')
  const smellFindings = byCategory('CODE_SMELL')

  const secSection = secFindings.length
    ? `### Security\n${secFindings.map(f => `- **${f.title}** — \`${f.filePath}:${f.lineStart}\``).join('\n')}`
    : ''

  const smellSection = smellFindings.length
    ? `### Code Smell\n${smellFindings.map(f => `- **${f.title}** — \`${f.filePath}:${f.lineStart}\``).join('\n')}`
    : ''

  const truncatedNote = truncated
    ? '\n> ⚠️ **Note:** This PR was too large to analyze in full. Results cover the highest-impact files.\n'
    : ''

  return `## 🤖 AI Code Review Summary
${truncatedNote}
| Metric | Score |
|--------|-------|
| 🔒 Security | ${summary.securityScore}/100 |
| ✨ Code Quality | ${summary.qualityScore}/100 |

### Findings

| Severity | Count |
|----------|-------|
| 🚨 Critical | ${bySeverity('CRITICAL')} |
| ⚠️ High | ${bySeverity('HIGH')} |
| 🔶 Medium | ${bySeverity('MEDIUM')} |

${secSection}

${smellSection}

### Recommended Actions
${summary.recommendedActions.map(a => `- ${a}`).join('\n')}

---
*Powered by AI Code Review*`
}

export async function publishGitHubReview(params: {
  token: string
  owner: string
  repo: string
  prNumber: number
  headSha: string
  publishableFindings: AIFinding[]
  summary: ReviewSummary
  allFindings: AIFinding[]
  truncated: boolean
  // Optional injectable Octokit instance — allows unit tests to pass a mock without patching ESM module exports
  _octokit?: InstanceType<typeof Octokit>
}): Promise<number> {
  const octokit = params._octokit ?? new Octokit({ auth: params.token })

  const comments = params.publishableFindings.map(f => ({
    path: f.filePath,
    line: f.lineStart,
    body: formatFindingBody(f),
  }))

  const { data } = await octokit.pulls.createReview({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    commit_id: params.headSha,
    event: 'COMMENT',
    body: formatSummaryBody(params.summary, params.allFindings, params.truncated),
    comments,
  })

  return data.id
}
