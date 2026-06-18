'use client'

import { useEffect, useState, useCallback } from 'react'
import { FindingCard } from '@/components/finding-card'
import { FindingsSummary } from '@/components/findings-summary'
import { ProcessingProgress } from '@/components/processing-progress'
import { ReviewStatusBadge } from '@/components/review-status-badge'
import { ScoreRing } from '@/components/score-ring'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface Finding {
  id: string; title: string; description: string; suggestion: string
  severity: string; category: string; filePath: string; lineStart: number; confidence: number
}

interface Review {
  id: string; status: string; processingStage: string | null
  securityScore: number | null; qualityScore: number | null
  findingsCount: number; startedAt: string | null; completedAt: string | null
  errorMessage: string | null
  findings: Finding[]
  pullRequest: {
    number: number; title: string; authorLogin: string
    headBranch: string; baseBranch: string
    repository: { fullName: string }
  }
}

export default function ReviewDetailPage({ params }: { params: { reviewId: string } }) {
  const [review, setReview] = useState<Review | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchReview = useCallback(async () => {
    const res = await fetch(`/api/reviews/${params.reviewId}`)
    if (res.ok) {
      const data = await res.json()
      setReview(data)
      if (data.status === 'COMPLETED' || data.status === 'FAILED') setLoading(false)
    }
  }, [params.reviewId])

  useEffect(() => {
    fetchReview()
  }, [fetchReview])

  useEffect(() => {
    if (!review || review.status === 'COMPLETED' || review.status === 'FAILED') return
    const interval = setInterval(async () => {
      const res = await fetch(`/api/reviews/${params.reviewId}/status`)
      if (res.ok) {
        const status = await res.json()
        if (status.status === 'COMPLETED' || status.status === 'FAILED') {
          await fetchReview()
          clearInterval(interval)
        } else {
          setReview(prev => prev ? { ...prev, ...status } : prev)
        }
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [review?.status, params.reviewId, fetchReview])

  if (!review && loading) {
    return <div className="max-w-4xl mx-auto px-4 py-8 text-muted-foreground">Loading review...</div>
  }

  if (!review) {
    return <div className="max-w-4xl mx-auto px-4 py-8">Review not found.</div>
  }

  const { pullRequest: pr } = review
  const findings = review.findings ?? []
  const secFindings = findings.filter(f => f.category === 'SECURITY')
  const smellFindings = findings.filter(f => f.category === 'CODE_SMELL')

  const duration = review.startedAt && review.completedAt
    ? Math.round((new Date(review.completedAt).getTime() - new Date(review.startedAt).getTime()) / 1000)
    : null

  const prUrl = `https://github.com/${pr?.repository?.fullName}/pull/${pr?.number}`
  const repoUrl = `https://github.com/${pr?.repository?.fullName}`

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">{pr?.repository?.fullName} #{pr?.number}</p>
            <h1 className="text-xl font-bold truncate">{pr?.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              by @{pr?.authorLogin} · {pr?.baseBranch} ← {pr?.headBranch}
            </p>
          </div>
          <ReviewStatusBadge status={review.status as any} />
        </div>

        <div className="flex gap-3 mt-4">
          <a href={prUrl} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">View Pull Request ↗</Button>
          </a>
          <a href={repoUrl} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">View Repository ↗</Button>
          </a>
        </div>

        {duration != null && (
          <div className="flex gap-6 mt-4 text-xs text-muted-foreground">
            {review.startedAt && <span>Started: {new Date(review.startedAt).toLocaleTimeString()}</span>}
            {review.completedAt && <span>Completed: {new Date(review.completedAt).toLocaleTimeString()}</span>}
            <span>Duration: {duration}s</span>
          </div>
        )}
      </div>

      <Separator className="mb-6" />

      {review.status === 'PROCESSING' && (
        <ProcessingProgress currentStage={review.processingStage} />
      )}

      {review.status === 'FAILED' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-red-800">Review failed</p>
          {review.errorMessage && (
            <p className="text-xs text-red-600 mt-1">{review.errorMessage}</p>
          )}
        </div>
      )}

      {review.status === 'COMPLETED' && (
        <>
          <div className="flex gap-8 justify-center mb-6">
            <ScoreRing score={review.securityScore ?? 0} label="Security" />
            <ScoreRing score={review.qualityScore ?? 0} label="Code Quality" />
          </div>

          <div className="mb-6">
            <FindingsSummary
              critical={findings.filter(f => f.severity === 'CRITICAL').length}
              high={findings.filter(f => f.severity === 'HIGH').length}
              medium={findings.filter(f => f.severity === 'MEDIUM').length}
            />
          </div>

          {secFindings.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3">Security</h2>
              {secFindings.map(f => <FindingCard key={f.id} {...f} />)}
            </div>
          )}

          {smellFindings.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3">Code Smell</h2>
              {smellFindings.map(f => <FindingCard key={f.id} {...f} />)}
            </div>
          )}

          {findings.length === 0 && (
            <div className="text-center py-12 text-muted-foreground border rounded-lg">
              <p className="text-lg">No significant findings</p>
              <p className="text-sm mt-1">This PR looks clean!</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
