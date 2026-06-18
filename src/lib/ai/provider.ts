import type { PullRequestDiff, AIFinding, ReviewSummary, ReviewContext } from './types'

export interface AIProvider {
  healthCheck(): Promise<boolean>
  analyzeSecurity(diff: PullRequestDiff): Promise<AIFinding[]>
  analyzeCodeSmells(diff: PullRequestDiff): Promise<AIFinding[]>
  generateSummary(
    findings: AIFinding[],
    diff: PullRequestDiff,
    context: ReviewContext
  ): Promise<ReviewSummary>
}
