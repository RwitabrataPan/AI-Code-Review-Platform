import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { validateWebhookSignature } from '@/lib/github/webhook'
import { enqueueReviewJob } from '@/lib/queue'
import type { PullRequestWebhookPayload, InstallationWebhookPayload } from '@/lib/github/types'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = Buffer.from(await request.arrayBuffer())
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const event = request.headers.get('x-github-event') ?? ''
  const deliveryId = request.headers.get('x-github-delivery') ?? crypto.randomUUID()

  if (!validateWebhookSignature(rawBody, signature, process.env.GITHUB_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(rawBody.toString('utf8'))

  const delivery = await prisma.webhookDelivery.create({
    data: {
      githubDeliveryId: deliveryId,
      event,
      action: payload.action ?? null,
      payload,
      signature,
      status: 'RECEIVED',
    },
  })

  try {
    await routeEvent(event, payload, delivery.id)
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { processedAt: new Date() },
    })
  } catch (error) {
    logger.error({ error, deliveryId }, 'Webhook routing failed')
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown',
        processedAt: new Date(),
      },
    })
  }

  return NextResponse.json({ ok: true })
}

async function routeEvent(event: string, payload: unknown, deliveryId: string): Promise<void> {
  if (event === 'pull_request') {
    await handlePullRequest(payload as PullRequestWebhookPayload, deliveryId)
  } else if (event === 'installation') {
    await handleInstallation(payload as InstallationWebhookPayload, deliveryId)
  } else if (event === 'installation_repositories') {
    await handleInstallationRepositories(payload as InstallationWebhookPayload, deliveryId)
  } else {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
  }
}

async function handlePullRequest(
  payload: PullRequestWebhookPayload,
  deliveryId: string
): Promise<void> {
  const { action, pull_request: pr, repository, installation } = payload

  if (!['opened', 'synchronize', 'reopened'].includes(action)) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  const installRecord = await prisma.installation.findUnique({
    where: { githubInstallId: installation.id },
  })

  if (!installRecord || !installRecord.active) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  const repo = await prisma.repository.upsert({
    where: { githubRepoId: repository.id },
    update: { fullName: repository.full_name },
    create: {
      githubRepoId: repository.id,
      fullName: repository.full_name,
      private: repository.private,
      installationId: installRecord.id,
    },
  })

  const pullRequest = await prisma.pullRequest.upsert({
    where: { repositoryId_githubPrId: { repositoryId: repo.id, githubPrId: pr.id } },
    update: {
      title: pr.title,
      state: pr.state,
      headSha: pr.head.sha,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
    },
    create: {
      githubPrId: pr.id,
      number: pr.number,
      title: pr.title,
      authorLogin: pr.user.login,
      state: pr.state,
      headSha: pr.head.sha,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      repositoryId: repo.id,
    },
  })

  // Skip if already reviewed this commit
  if (pullRequest.lastReviewedSha === pr.head.sha) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  const review = await prisma.review.create({
    data: { pullRequestId: pullRequest.id, status: 'PENDING' },
  })

  await enqueueReviewJob({
    reviewId: review.id,
    pullRequestId: pullRequest.id,
    installationId: installation.id,
    owner: repository.owner.login,
    repo: repository.name,
    prNumber: pr.number,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
  })

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'ENQUEUED', reviewId: review.id },
  })
}

async function handleInstallation(
  payload: InstallationWebhookPayload,
  deliveryId: string
): Promise<void> {
  const { action, installation } = payload

  if (action === 'deleted') {
    await prisma.installation.updateMany({
      where: { githubInstallId: installation.id },
      data: { active: false },
    })
  }

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'ENQUEUED' },
  })
}

async function handleInstallationRepositories(
  payload: InstallationWebhookPayload,
  deliveryId: string
): Promise<void> {
  const { action, installation, repositories } = payload

  if (!repositories?.length) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  const installRecord = await prisma.installation.findUnique({
    where: { githubInstallId: installation.id },
  })

  if (!installRecord) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  if (action === 'added') {
    await Promise.all(
      repositories.map(r =>
        prisma.repository.upsert({
          where: { githubRepoId: r.id },
          update: { fullName: r.full_name, private: r.private },
          create: {
            githubRepoId: r.id,
            fullName: r.full_name,
            private: r.private,
            installationId: installRecord.id,
          },
        })
      )
    )
  } else if (action === 'removed') {
    await prisma.repository.deleteMany({
      where: { githubRepoId: { in: repositories.map(r => r.id) } },
    })
  }

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'ENQUEUED' },
  })
}
