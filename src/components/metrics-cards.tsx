import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MetricsCardsProps {
  repoCount: number
  prCount: number
  criticalCount: number
  avgSecurityScore: number | null
}

export function MetricsCards({ repoCount, prCount, criticalCount, avgSecurityScore }: MetricsCardsProps) {
  const metrics = [
    { label: 'Repositories Reviewed', value: repoCount },
    { label: 'Pull Requests Reviewed', value: prCount },
    { label: 'Critical Findings', value: criticalCount },
    { label: 'Avg Security Score', value: avgSecurityScore != null ? `${avgSecurityScore}/100` : '–' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {metrics.map(m => (
        <Card key={m.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{m.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{m.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
