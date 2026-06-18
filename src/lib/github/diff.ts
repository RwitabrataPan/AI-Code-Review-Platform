import { Octokit } from '@octokit/rest'
import type { PullRequestDiff, DiffFile } from '@/lib/ai/types'

const MAX_PATCH_LINES = 8000

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', java: 'java', cs: 'csharp',
  php: 'php', rs: 'rust', cpp: 'cpp', c: 'c', swift: 'swift', kt: 'kotlin',
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_MAP[ext] ?? 'unknown'
}

export async function fetchPRDiff(params: {
  token: string
  owner: string
  repo: string
  prNumber: number
  prTitle: string
  prDescription: string
  baseBranch: string
  headBranch: string
}): Promise<{ diff: PullRequestDiff; truncated: boolean }> {
  const octokit = new Octokit({ auth: params.token })

  const { data: files } = await octokit.pulls.listFiles({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    per_page: 100,
  })

  const sorted = [...files].sort((a, b) => b.additions - a.additions)

  const diffFiles: DiffFile[] = []
  let totalLines = 0
  let truncated = false

  for (const file of sorted) {
    if (!file.patch) continue
    const lines = file.patch.split('\n').length
    if (totalLines + lines > MAX_PATCH_LINES) {
      truncated = true
      break
    }
    totalLines += lines
    diffFiles.push({
      path: file.filename,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      language: detectLanguage(file.filename),
    })
  }

  return {
    diff: {
      files: diffFiles,
      prTitle: params.prTitle,
      prDescription: params.prDescription ?? '',
      repoFullName: `${params.owner}/${params.repo}`,
      baseBranch: params.baseBranch,
      headBranch: params.headBranch,
    },
    truncated,
  }
}
