interface FindingsSummaryProps {
  critical: number
  high: number
  medium: number
}

export function FindingsSummary({ critical, high, medium }: FindingsSummaryProps) {
  return (
    <div className="flex gap-4">
      {critical > 0 && (
        <span className="text-sm font-medium text-red-600">🚨 {critical} Critical</span>
      )}
      {high > 0 && (
        <span className="text-sm font-medium text-orange-500">⚠️ {high} High</span>
      )}
      {medium > 0 && (
        <span className="text-sm font-medium text-yellow-500">🔶 {medium} Medium</span>
      )}
      {critical === 0 && high === 0 && medium === 0 && (
        <span className="text-sm text-muted-foreground">No significant findings</span>
      )}
    </div>
  )
}
