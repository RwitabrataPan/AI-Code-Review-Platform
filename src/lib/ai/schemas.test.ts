import { describe, it, expect } from 'vitest'
import { findingsSchema, summarySchema } from './schemas'

describe('findingsSchema', () => {
  it('parses a valid finding array', () => {
    const input = [{
      category: 'SECURITY',
      severity: 'CRITICAL',
      title: 'SQL Injection',
      description: 'User input concatenated into query',
      suggestion: 'Use parameterised queries',
      filePath: 'src/db.ts',
      lineStart: 42,
      confidence: 0.97,
    }]
    expect(() => findingsSchema.parse(input)).not.toThrow()
  })

  it('parses an empty array', () => {
    expect(findingsSchema.parse([])).toEqual([])
  })

  it('rejects a finding with missing suggestion', () => {
    const bad = [{ category: 'SECURITY', severity: 'HIGH', title: 'X',
      description: 'Y', filePath: 'a.ts', lineStart: 1, confidence: 0.9 }]
    expect(() => findingsSchema.parse(bad)).toThrow()
  })

  it('rejects confidence outside 0-1', () => {
    const bad = [{ category: 'SECURITY', severity: 'HIGH', title: 'X',
      description: 'Y', suggestion: 'Z', filePath: 'a.ts', lineStart: 1, confidence: 1.5 }]
    expect(() => findingsSchema.parse(bad)).toThrow()
  })
})

describe('summarySchema', () => {
  it('parses a valid summary', () => {
    const input = { securityScore: 85, qualityScore: 90, recommendedActions: ['Fix SQL injection'] }
    expect(() => summarySchema.parse(input)).not.toThrow()
  })

  it('rejects score above 100', () => {
    expect(() => summarySchema.parse({ securityScore: 101, qualityScore: 90, recommendedActions: ['x'] })).toThrow()
  })
})
