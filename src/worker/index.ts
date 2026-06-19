import { Worker } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { PR_ANALYSIS_QUEUE } from '@/lib/queue'
import { processAnalyzePR } from './processors/analyze-pr'

async function recoverStuckReviews(): Promise<void> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000)
  const stuck = await prisma.review.findMany({
    where: { status: 'PROCESSING', startedAt: { lt: cutoff } },
    select: { id: true },
  })

  if (stuck.length > 0) {
    logger.warn({ count: stuck.length }, 'Recovering stuck reviews')
    await prisma.review.updateMany({
      where: { id: { in: stuck.map(r => r.id) } },
      data: { status: 'FAILED', errorMessage: 'Worker interrupted', processingStage: null },
    })
  }
}

async function main() {
  logger.info('Worker starting up')

  await recoverStuckReviews()

  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379')
  const connection: ConnectionOptions = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    maxRetriesPerRequest: null,
  }

  const worker = new Worker(PR_ANALYSIS_QUEUE, processAnalyzePR, {
    connection,
    concurrency: 3,
    // BullMQ v5 removed per-job timeout from JobOptions; lockDuration is the equivalent enforcement mechanism
    lockDuration: 300_000,
  })

  worker.on('completed', job => {
    logger.info({ jobId: job.id }, 'Job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Job failed')
  })

  logger.info('Worker ready — listening for jobs')

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — shutting down')
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
  })
}

main().catch(err => {
  logger.error({ err }, 'Worker crashed on startup')
  process.exit(1)
})
