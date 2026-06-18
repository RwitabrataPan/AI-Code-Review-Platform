import { ClaudeProvider } from './providers/claude'
import type { AIProvider } from './provider'

export function getAIProvider(): AIProvider {
  return new ClaudeProvider()
}

export type { AIProvider } from './provider'
export type { AIFinding, PullRequestDiff, ReviewSummary, ReviewContext, DiffFile } from './types'
