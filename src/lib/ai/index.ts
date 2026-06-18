import { ClaudeProvider } from './providers/claude'
import { MockAIProvider } from './providers/mock'
import type { AIProvider } from './provider'

export function getAIProvider(): AIProvider {
  if (process.env.USE_MOCK_AI === 'true') {
    return new MockAIProvider()
  }
  return new ClaudeProvider()
}

export type { AIProvider } from './provider'
export type { AIFinding, PullRequestDiff, ReviewSummary, ReviewContext, DiffFile } from './types'
