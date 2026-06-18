const STAGES = [
  { key: 'FETCHING_DIFF',        label: 'Fetching Diff' },
  { key: 'SECURITY_ANALYSIS',    label: 'Running Security Analysis' },
  { key: 'CODE_SMELL_ANALYSIS',  label: 'Running Code Smell Analysis' },
  { key: 'GENERATING_SUMMARY',   label: 'Generating Summary' },
  { key: 'PUBLISHING',           label: 'Publishing Review' },
]

export function ProcessingProgress({ currentStage }: { currentStage: string | null }) {
  const currentIndex = STAGES.findIndex(s => s.key === currentStage)

  return (
    <div className="space-y-2 py-4">
      {STAGES.map((stage, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <div key={stage.key} className={`flex items-center gap-3 text-sm ${
            done ? 'text-green-600' : active ? 'text-blue-600 font-medium' : 'text-muted-foreground'
          }`}>
            <span>{done ? '✓' : active ? '⟳' : '○'}</span>
            <span>{stage.label}</span>
          </div>
        )
      })}
    </div>
  )
}
