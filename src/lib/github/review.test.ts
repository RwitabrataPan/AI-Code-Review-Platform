import { describe, it, expect, vi, beforeEach } from 'vitest'
import { publishGitHubReview } from './review'

const mockCreateReview = vi.fn().mockResolvedValue({ data: { id: 42 } })

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    pulls = { createReview: mockCreateReview }
  },
}))

describe('publishGitHubReview', () => {
  beforeEach(() => {
    mockCreateReview.mockClear()
    mockCreateReview.mockResolvedValue({ data: { id: 42 } })
  })

  it('returns the GitHub review ID', async () => {
    const id = await publishGitHubReview({
      token: 'tok', owner: 'o', repo: 'r', prNumber: 1,
      headSha: 'abc123',
      publishableFindings: [],
      summary: { securityScore: 90, qualityScore: 85, recommendedActions: ['Fix XSS'] },
      allFindings: [],
      truncated: false,
    })
    expect(id).toBe(42)
  })

  it('maps findings to GitHub inline comments', async () => {
    await publishGitHubReview({
      token: 'tok', owner: 'o', repo: 'r', prNumber: 1,
      headSha: 'abc',
      publishableFindings: [{
        category: 'SECURITY', severity: 'CRITICAL', title: 'XSS',
        description: 'Unescaped output', suggestion: 'Use escaping',
        filePath: 'src/render.ts', lineStart: 10, confidence: 0.95,
      }],
      summary: { securityScore: 50, qualityScore: 80, recommendedActions: ['Escape output'] },
      allFindings: [],
      truncated: false,
    })
    const call = mockCreateReview.mock.calls[mockCreateReview.mock.calls.length - 1][0]
    expect(call.comments[0].path).toBe('src/render.ts')
    expect(call.comments[0].line).toBe(10)
  })
})
