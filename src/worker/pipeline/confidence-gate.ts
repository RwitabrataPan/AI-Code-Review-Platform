import type { AIFinding } from '@/lib/ai/types'

export const PUBLISH_THRESHOLD = 0.85
export const SAVE_THRESHOLD = 0.70

export function applyConfidenceGate(findings: AIFinding[]): {
  publishable: AIFinding[]
  savedOnly: AIFinding[]
} {
  return {
    publishable: findings.filter(f => f.confidence >= PUBLISH_THRESHOLD),
    savedOnly: findings.filter(
      f => f.confidence >= SAVE_THRESHOLD && f.confidence < PUBLISH_THRESHOLD
    ),
  }
}
