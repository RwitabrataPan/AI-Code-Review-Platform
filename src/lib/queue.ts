import { Queue } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'

export const PR_ANALYSIS_QUEUE = 'pr-analysis'

export interface AnalyzePRJobData {
  reviewId: string
  pullRequestId: string
  installationId: number
  owner: string
  repo: string
  prNumber: number
  headSha: string
  baseSha: string
  headBranch: string
  baseBranch: string
}

// ponytail: separate connection config avoids bullmq's bundled ioredis conflicting with our top-level ioredis instance
function getBullMQConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379')
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    maxRetriesPerRequest: null,
  }
}

export const prAnalysisQueue = new Queue<AnalyzePRJobData, void, string>(PR_ANALYSIS_QUEUE, {
  connection: getBullMQConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 604_800 },
  },
})

export async function enqueueReviewJob(data: AnalyzePRJobData): Promise<void> {
  await prAnalysisQueue.add('analyze-pr', data, { jobId: data.reviewId })
}
