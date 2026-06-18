interface ScoreRingProps {
  score: number
  label: string
  size?: number
}

export function ScoreRing({ score, label, size = 80 }: ScoreRingProps) {
  const radius = (size - 10) / 2
  const circumference = 2 * Math.PI * radius
  const filled = ((score ?? 0) / 100) * circumference
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444'

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="text-2xl font-bold -mt-14">{score ?? '–'}</span>
      <span className="text-xs text-muted-foreground mt-10">{label}</span>
    </div>
  )
}
