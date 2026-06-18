import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeProvider } from './claude'

// Module-level mock fn shared across all instances of the mock class
const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'text', text: '[]' }],
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: mockCreate }
  },
}))

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    mockCreate.mockClear()
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] })
    provider = new ClaudeProvider()
  })

  it('analyzeSecurity returns empty array when Claude returns []', async () => {
    const diff = {
      files: [], prTitle: 'Test PR', prDescription: '',
      repoFullName: 'owner/repo', baseBranch: 'main', headBranch: 'feature',
    }
    const result = await provider.analyzeSecurity(diff)
    expect(result).toEqual([])
  })

  it('analyzeCodeSmells returns empty array when Claude returns []', async () => {
    const diff = {
      files: [], prTitle: 'Test PR', prDescription: '',
      repoFullName: 'owner/repo', baseBranch: 'main', headBranch: 'feature',
    }
    const result = await provider.analyzeCodeSmells(diff)
    expect(result).toEqual([])
  })

  it('throws when Claude returns invalid JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json' }],
    })
    const diff = {
      files: [], prTitle: 'T', prDescription: '',
      repoFullName: 'o/r', baseBranch: 'main', headBranch: 'feat',
    }
    await expect(provider.analyzeSecurity(diff)).rejects.toThrow()
  })
})
