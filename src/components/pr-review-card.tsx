import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ReviewStatusBadge } from './review-status-badge'
import { FindingsSummary } from './findings-summary'

interface PRReviewCardProps {
  reviewId: string
  prNumber: number
  prTitle: string
  repoFullName: string
  authorLogin: string
  status: string
  securityScore: number | null
  qualityScore: number | null
  criticalCount: number
  highCount: number
  mediumCount: number
}

export function PRReviewCard(props: PRReviewCardProps) {
  const { reviewId, prNumber, prTitle, repoFullName, authorLogin, status,
    securityScore, qualityScore, criticalCount, highCount, mediumCount } = props

  return (
    <Link href={`/reviews/${reviewId}`}>
      <Card className="mb-3 hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground mb-1">
                {repoFullName} #{prNumber}
              </p>
              <p className="font-medium text-sm truncate">{prTitle}</p>
              <p className="text-xs text-muted-foreground mt-1">by @{authorLogin}</p>
            </div>
            <ReviewStatusBadge status={status as any} />
          </div>

          {status === 'COMPLETED' && (
            <div className="mt-3 flex items-center justify-between">
              <FindingsSummary critical={criticalCount} high={highCount} medium={mediumCount} />
              <div className="flex gap-4 text-xs text-muted-foreground">
                {securityScore != null && <span>🔒 {securityScore}</span>}
                {qualityScore != null && <span>✨ {qualityScore}</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
