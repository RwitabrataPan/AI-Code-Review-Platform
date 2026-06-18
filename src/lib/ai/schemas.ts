import { z } from 'zod'

const findingSchema = z.object({
  category: z.enum(['SECURITY', 'CODE_SMELL']),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
  title: z.string().min(1),
  description: z.string().min(1),
  suggestion: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().optional(),
  confidence: z.number().min(0).max(1),
})

export const findingsSchema = z.array(findingSchema)

export const summarySchema = z.object({
  securityScore: z.number().int().min(0).max(100),
  qualityScore: z.number().int().min(0).max(100),
  recommendedActions: z.array(z.string().min(1)).min(1),
})

export type FindingSchema = z.infer<typeof findingSchema>
export type SummarySchema = z.infer<typeof summarySchema>
