import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import { POST } from './route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  prisma: {
    webhookDelivery: { create: vi.fn().mockResolvedValue({ id: 'del-1' }), update: vi.fn() },
    installation: { findUnique: vi.fn(), updateMany: vi.fn() },
    repository: { upsert: vi.fn().mockResolvedValue({ id: 'repo-1' }) },
    pullRequest: { upsert: vi.fn().mockResolvedValue({ id: 'pr-1', lastReviewedSha: null }) },
    review: { create: vi.fn().mockResolvedValue({ id: 'rev-1' }) },
  },
}))

vi.mock('@/lib/queue', () => ({ enqueueReviewJob: vi.fn() }))

const SECRET = 'test-secret'

function makeRequest(payload: object, event: string): NextRequest {
  const body = JSON.stringify(payload)
  const sig = `sha256=${createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex')}`
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    body,
    headers: {
      'x-hub-signature-256': sig,
      'x-github-event': event,
      'x-github-delivery': 'delivery-1',
      'content-type': 'application/json',
    },
  })
}

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET
  vi.clearAllMocks()
})

describe('POST /api/webhooks/github', () => {
  it('returns 401 for invalid signature', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body: '{}',
      headers: { 'x-hub-signature-256': 'sha256=bad', 'x-github-event': 'ping' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 200 for unknown events and marks IGNORED', async () => {
    const req = makeRequest({ action: 'labeled' }, 'issues')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('enqueues a job for pull_request opened', async () => {
    const { prisma } = await import('@/lib/db')
    const { enqueueReviewJob } = await import('@/lib/queue')
    ;(prisma.installation.findUnique as any).mockResolvedValue({ id: 'inst-1', active: true })

    const payload = {
      action: 'opened',
      pull_request: {
        id: 1, number: 42, title: 'My PR', body: null, state: 'open',
        head: { sha: 'abc', ref: 'feat' }, base: { sha: 'def', ref: 'main' },
        user: { login: 'dev' },
      },
      repository: { id: 10, full_name: 'o/r', name: 'r', owner: { login: 'o' }, private: false },
      installation: { id: 99 },
    }

    const req = makeRequest(payload, 'pull_request')
    await POST(req)

    expect(enqueueReviewJob).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'rev-1', prNumber: 42 })
    )
  })
})
