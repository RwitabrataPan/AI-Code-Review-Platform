import type { AIFinding } from '@/lib/ai/types'

export function deduplicateFindings(findings: AIFinding[]): AIFinding[] {
  const map = new Map<string, AIFinding>()

  for (const finding of findings) {
    const key = `${finding.filePath}:${finding.lineStart}:${finding.title}`
    const existing = map.get(key)
    if (!existing || finding.confidence > existing.confidence) {
      map.set(key, finding)
    }
  }

  return Array.from(map.values())
}
