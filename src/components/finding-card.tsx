import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH:     'bg-orange-100 text-orange-800',
  MEDIUM:   'bg-yellow-100 text-yellow-800',
  LOW:      'bg-blue-100 text-blue-800',
  INFO:     'bg-gray-100 text-gray-800',
}

interface FindingCardProps {
  title: string
  description: string
  suggestion: string
  severity: string
  category: string
  filePath: string
  lineStart: number
  confidence: number
}

export function FindingCard(props: FindingCardProps) {
  const { title, description, suggestion, severity, category, filePath, lineStart, confidence } = props
  return (
    <Card className="mb-3">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex gap-2 flex-wrap">
            <Badge className={SEVERITY_COLOR[severity] ?? ''}>{severity}</Badge>
            <Badge variant="outline">{category.replace('_', ' ')}</Badge>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {confidence >= 0.9 ? '🟢' : confidence >= 0.8 ? '🟡' : '🔴'} {Math.round(confidence * 100)}%
          </span>
        </div>
        <p className="font-semibold text-sm mb-1">{title}</p>
        <p className="text-sm text-muted-foreground mb-2">{description}</p>
        <div className="bg-muted rounded px-3 py-2 text-sm">
          <span className="font-medium">Fix: </span>{suggestion}
        </div>
        <p className="text-xs text-muted-foreground mt-2 font-mono">
          {filePath}:{lineStart}
        </p>
      </CardContent>
    </Card>
  )
}
