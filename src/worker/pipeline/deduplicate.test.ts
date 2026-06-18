import { describe, it, expect } from 'vitest'
import { deduplicateFindings } from './deduplicate'
import type { AIFinding } from '@/lib/ai/types'

const base: AIFinding = {
  category: 'SECURITY', severity: 'HIGH', title: 'XSS',
  description: 'Unescaped output', suggestion: 'Escape it',
  filePath: 'src/render.ts', lineStart: 10, confidence: 0.9,
}

describe('deduplicateFindings', () => {
  it('returns unique findings when no duplicates', () => {
    const findings = [base, { ...base, filePath: 'src/other.ts' }]
    expect(deduplicateFindings(findings)).toHaveLength(2)
  })

  it('keeps higher-confidence finding on clash', () => {
    const low = { ...base, confidence: 0.7 }
    const high = { ...base, confidence: 0.95 }
    const result = deduplicateFindings([low, high])
    expect(result).toHaveLength(1)
    expect(result[0].confidence).toBe(0.95)
  })

  it('treats different titles on same line as different findings', () => {
    const a = { ...base, title: 'XSS' }
    const b = { ...base, title: 'SQL Injection' }
    expect(deduplicateFindings([a, b])).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(deduplicateFindings([])).toEqual([])
  })
})
