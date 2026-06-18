import type { Job } from 'bullmq'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getInstallationToken } from '@/lib/github/app'
import { fetchPRDiff } from '@/lib/github/diff'
import { publishGitHubReview } from '@/lib/github/review'
import { getAIProvider } from '@/lib/ai'
import { deduplicateFindings } from '../pipeline/deduplicate'
import { applyConfidenceGate } from '../pipeline/confidence-gate'
import type { AnalyzePRJobData } from '@/lib/queue'
import type { ReviewContext } from '@/lib/ai/types'

async function setStage(reviewId: string, stage: string | null) {
  await prisma.review.update({
    where: { id: reviewId },
    data: { processingStage: stage },
  })
}

export async function processAnalyzePR(job: Job<AnalyzePRJobData>): Promise<void> {
  const { reviewId, pullRequestId, installationId, owner, repo, prNumber, headSha, headBranch, baseBranch } = job.data
  const log = logger.child({ reviewId, jobId: job.id })

  // Guard: skip if already reviewed
  const pr = await prisma.pullRequest.findUnique({ where: { id: pullRequestId } })
  if (pr?.lastReviewedSha === headSha) {
    log.info('Skipping: commit already reviewed')
    return
  }

  // Transition: PENDING → PROCESSING
  const review = await prisma.review.findUnique({ where: { id: reviewId } })
  if (review?.status !== 'PENDING') {
    throw new Error(`Invalid status transition: ${review?.status} → PROCESSING`)
  }
  await prisma.review.update({
    where: { id: reviewId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  })

  try {
    // Stage 1: Fetch diff
    await setStage(reviewId, 'FETCHING_DIFF')
    const token = await getInstallationToken(installationId)
    const pullRequest = await prisma.pullRequest.findUniqueOrThrow({ where: { id: pullRequestId } })
    const { diff, truncated } = await fetchPRDiff({
      token, owner, repo, prNumber,
      prTitle: pullRequest.title,
      prDescription: '',
      baseBranch,
      headBranch,
    })

    // Stage 2: Parallel AI analysis
    await setStage(reviewId, 'SECURITY_ANALYSIS')
    const provider = getAIProvider()
    const [securityFindings, codeSmellFindings] = await Promise.all([
      provider.analyzeSecurity(diff),
      provider.analyzeCodeSmells(diff),
    ])

    // Merge → deduplicate → confidence gate
    const merged = [...securityFindings, ...codeSmellFindings]
    const deduped = deduplicateFindings(merged)
    const { publishable, savedOnly } = applyConfidenceGate(deduped)
    const toSave = [...publishable, ...savedOnly]

    // Save findings to DB
    if (toSave.length > 0) {
      await prisma.finding.createMany({
        data: toSave.map(f => ({
          reviewId,
          category: f.category,
          severity: f.severity,
          title: f.title,
          description: f.description,
          suggestion: f.suggestion,
          filePath: f.filePath,
          lineStart: f.lineStart,
          lineEnd: f.lineEnd ?? null,
          confidence: f.confidence,
          published: publishable.includes(f),
        })),
      })
    }

    // Stage 3: Generate summary
    await setStage(reviewId, 'GENERATING_SUMMARY')
    const context: ReviewContext = {
      repoFullName: `${owner}/${repo}`,
      prSize: diff.files.length < 5 ? 'small' : diff.files.length < 20 ? 'medium' : 'large',
      fileCount: diff.files.length,
      languages: [...new Set(diff.files.map(f => f.language))],
    }
    const summary = await provider.generateSummary(publishable, diff, context)

    // Stage 4: Publish to GitHub
    await setStage(reviewId, 'PUBLISHING')
    let githubReviewId: number | null = null
    try {
      githubReviewId = await publishGitHubReview({
        token, owner, repo, prNumber, headSha,
        publishableFindings: publishable,
        summary,
        allFindings: publishable,
        truncated,
      })
    } catch (publishError) {
      // Analysis work is already saved — mark FAILED but don't rethrow
      await prisma.review.update({
        where: { id: reviewId },
        data: {
          status: 'FAILED',
          errorMessage: `GitHub publish failed: ${publishError instanceof Error ? publishError.message : 'Unknown'}`,
          processingStage: null,
        },
      })
      log.error({ err: publishError }, 'GitHub publish failed — analysis saved')
      return
    }

    // Transition: PROCESSING → COMPLETED
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        status: 'COMPLETED',
        processingStage: null,
        securityScore: summary.securityScore,
        qualityScore: summary.qualityScore,
        findingsCount: publishable.length,
        githubReviewId,
        completedAt: new Date(),
      },
    })

    await prisma.pullRequest.update({
      where: { id: pullRequestId },
      data: { lastReviewedSha: headSha },
    })

    log.info({
      securityScore: summary.securityScore,
      qualityScore: summary.qualityScore,
      findings: publishable.length,
      truncated,
    }, 'Review completed')

  } catch (error) {
    log.error({ err: error }, 'Review pipeline failed')
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        status: 'FAILED',
        processingStage: null,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    })
    throw error // Re-throw so BullMQ retries
  }
}
