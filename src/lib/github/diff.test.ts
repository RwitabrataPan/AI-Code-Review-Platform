import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPRDiff } from './diff'

// Module-level mock fn shared across all Octokit instances
const mockListFiles = vi.fn().mockResolvedValue({
  data: [
    { filename: 'src/auth.ts', patch: '+const x = 1', additions: 1, deletions: 0 },
    { filename: 'README.md', patch: '+# Title', additions: 1, deletions: 0 },
  ],
})

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    pulls = { listFiles: mockListFiles }
  },
}))

describe('fetchPRDiff', () => {
  beforeEach(() => {
    mockListFiles.mockClear()
    mockListFiles.mockResolvedValue({
      data: [
        { filename: 'src/auth.ts', patch: '+const x = 1', additions: 1, deletions: 0 },
        { filename: 'README.md', patch: '+# Title', additions: 1, deletions: 0 },
      ],
    })
  })

  it('builds a PullRequestDiff from GitHub API response', async () => {
    const { diff, truncated } = await fetchPRDiff({
      token: 'tok', owner: 'owner', repo: 'repo', prNumber: 1,
      prTitle: 'My PR', prDescription: '', baseBranch: 'main', headBranch: 'feat',
    })
    expect(diff.files).toHaveLength(2)
    expect(diff.files[0].path).toBe('src/auth.ts')
    expect(diff.files[0].language).toBe('typescript')
    expect(diff.repoFullName).toBe('owner/repo')
    expect(truncated).toBe(false)
  })

  it('skips files without a patch', async () => {
    mockListFiles.mockResolvedValueOnce({
      data: [{ filename: 'binary.png', patch: undefined, additions: 0, deletions: 0 }],
    })
    const { diff } = await fetchPRDiff({
      token: 'tok', owner: 'o', repo: 'r', prNumber: 1,
      prTitle: 'T', prDescription: '', baseBranch: 'main', headBranch: 'feat',
    })
    expect(diff.files).toHaveLength(0)
  })
})
