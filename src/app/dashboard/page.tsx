import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { MetricsCards } from '@/components/metrics-cards'
import { PRReviewCard } from '@/components/pr-review-card'
import { Button } from '@/components/ui/button'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/')

  const [repos, reviews, criticalCount, avgScore] = await Promise.all([
    prisma.repository.count({
      where: { installation: { userId: session.user.id, active: true } },
    }),

    prisma.review.findMany({
      where: { pullRequest: { repository: { installation: { userId: session.user.id } } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        pullRequest: { include: { repository: true } },
        findings: { select: { severity: true } },
      },
    }),

    prisma.finding.count({
      where: {
        severity: 'CRITICAL',
        review: { pullRequest: { repository: { installation: { userId: session.user.id } } } },
      },
    }),

    prisma.review.aggregate({
      where: { status: 'COMPLETED', pullRequest: { repository: { installation: { userId: session.user.id } } } },
      _avg: { securityScore: true },
    }),
  ])

  const appInstallUrl = `https://github.com/apps/${process.env.GITHUB_APP_NAME ?? 'your-app'}/installations/new`

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, @{session.user.login}</p>
        </div>
        <a href={appInstallUrl} target="_blank" rel="noreferrer">
          <Button variant="outline">Install GitHub App</Button>
        </a>
      </div>

      <MetricsCards
        repoCount={repos}
        prCount={reviews.length}
        criticalCount={criticalCount}
        avgSecurityScore={avgScore._avg.securityScore ? Math.round(avgScore._avg.securityScore) : null}
      />

      {reviews.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <p className="text-lg mb-2">No reviews yet</p>
          <p>Open a Pull Request on a repository with the app installed to trigger your first AI review.</p>
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold mb-4">Recent Reviews</h2>
          {reviews.map(review => {
            const findings = review.findings
            return (
              <PRReviewCard
                key={review.id}
                reviewId={review.id}
                prNumber={review.pullRequest.number}
                prTitle={review.pullRequest.title}
                repoFullName={review.pullRequest.repository.fullName}
                authorLogin={review.pullRequest.authorLogin}
                status={review.status}
                securityScore={review.securityScore}
                qualityScore={review.qualityScore}
                criticalCount={findings.filter(f => f.severity === 'CRITICAL').length}
                highCount={findings.filter(f => f.severity === 'HIGH').length}
                mediumCount={findings.filter(f => f.severity === 'MEDIUM').length}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
