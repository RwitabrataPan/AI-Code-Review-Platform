import { describe, it, expect } from 'vitest'
import { applyConfidenceGate } from './confidence-gate'
import type { AIFinding } from '@/lib/ai/types'

const make = (confidence: number): AIFinding => ({
  category: 'SECURITY', severity: 'HIGH', title: 'X', description: 'D',
  suggestion: 'S', filePath: 'f.ts', lineStart: 1, confidence,
})

describe('applyConfidenceGate', () => {
  it('puts ≥ 0.85 into publishable', () => {
    const { publishable } = applyConfidenceGate([make(0.85), make(0.95)])
    expect(publishable).toHaveLength(2)
  })

  it('puts 0.70–0.84 into savedOnly', () => {
    const { savedOnly } = applyConfidenceGate([make(0.70), make(0.84)])
    expect(savedOnly).toHaveLength(2)
  })

  it('discards < 0.70', () => {
    const { publishable, savedOnly } = applyConfidenceGate([make(0.69), make(0.50)])
    expect(publishable).toHaveLength(0)
    expect(savedOnly).toHaveLength(0)
  })

  it('handles mixed confidence levels', () => {
    const result = applyConfidenceGate([make(0.95), make(0.75), make(0.60)])
    expect(result.publishable).toHaveLength(1)
    expect(result.savedOnly).toHaveLength(1)
  })
})
