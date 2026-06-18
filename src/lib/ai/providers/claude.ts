import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider } from '../provider'
import type { PullRequestDiff, AIFinding, ReviewSummary, ReviewContext } from '../types'
import { findingsSchema, summarySchema } from '../schemas'

const MODEL = 'claude-sonnet-4-6'

export class ClaudeProvider implements AIProvider {
  private client: Anthropic

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return true
    } catch {
      return false
    }
  }

  async analyzeSecurity(diff: PullRequestDiff): Promise<AIFinding[]> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: `You are a security code reviewer. Analyze only the changed lines in the diff below.
Return a JSON array of security vulnerabilities. Only report findings you are highly confident are real issues.
Return [] if nothing qualifies. Never speculate. Never report style issues.

Each object must have: category ("SECURITY"), severity ("CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"INFO"),
title (string), description (string — why it's a problem), suggestion (string — concrete fix, required),
filePath (string), lineStart (integer), lineEnd (integer, optional), confidence (float 0.0–1.0).`,
      messages: [{ role: 'user', content: this.formatDiff(diff) }],
    })

    return findingsSchema.parse(this.extractJSON(this.getText(response)))
  }

  async analyzeCodeSmells(diff: PullRequestDiff): Promise<AIFinding[]> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: `You are a code quality reviewer. Analyze only the changed lines in the diff below.
Return a JSON array of code smell findings (e.g. long functions, high complexity, unclear naming, duplication).
Only report findings you are highly confident are real issues. Return [] if nothing qualifies.

Each object must have: category ("CODE_SMELL"), severity ("CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"INFO"),
title (string), description (string — why it's a problem), suggestion (string — concrete fix, required),
filePath (string), lineStart (integer), lineEnd (integer, optional), confidence (float 0.0–1.0).`,
      messages: [{ role: 'user', content: this.formatDiff(diff) }],
    })

    return findingsSchema.parse(this.extractJSON(this.getText(response)))
  }

  async generateSummary(
    findings: AIFinding[],
    diff: PullRequestDiff,
    context: ReviewContext
  ): Promise<ReviewSummary> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: `You are a code review summarizer. Given a list of findings from a PR review, produce scores and recommendations.
Return JSON with: securityScore (0–100 integer, 100 = no issues), qualityScore (0–100 integer),
recommendedActions (array of 1–5 concise action strings).`,
      messages: [{
        role: 'user',
        content: `Findings: ${JSON.stringify(findings)}\nRepo: ${context.repoFullName}\nFiles: ${context.fileCount}\nLanguages: ${context.languages.join(', ')}`,
      }],
    })

    return summarySchema.parse(this.extractJSON(this.getText(response)))
  }

  private getText(response: Anthropic.Message): string {
    const block = response.content[0]
    return block.type === 'text' ? block.text : ''
  }

  private formatDiff(diff: PullRequestDiff): string {
    const files = diff.files.map(f =>
      `=== File: ${f.path} (${f.language}) ===\n${f.patch}`
    ).join('\n\n')
    return `PR: ${diff.prTitle}\nRepo: ${diff.repoFullName} (${diff.baseBranch} ← ${diff.headBranch})\n\n${files}`
  }

  private extractJSON(text: string): unknown {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlock) return JSON.parse(codeBlock[1].trim())
    const inline = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (inline) return JSON.parse(inline[1])
    return JSON.parse(text.trim())
  }
}
