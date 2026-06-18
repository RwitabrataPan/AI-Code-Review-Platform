export interface DiffFile {
  path: string
  patch: string
  additions: number
  deletions: number
  language: string
}

export interface PullRequestDiff {
  files: DiffFile[]
  prTitle: string
  prDescription: string
  repoFullName: string
  baseBranch: string
  headBranch: string
}

export interface ReviewContext {
  repoFullName: string
  prSize: 'small' | 'medium' | 'large'
  fileCount: number
  languages: string[]
}

export interface AIFinding {
  category: 'SECURITY' | 'CODE_SMELL'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  title: string
  description: string
  suggestion: string
  filePath: string
  lineStart: number
  lineEnd?: number
  confidence: number
}

export interface ReviewSummary {
  securityScore: number
  qualityScore: number
  recommendedActions: string[]
}
