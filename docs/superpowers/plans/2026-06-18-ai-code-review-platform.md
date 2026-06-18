# AI Code Review Platform — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PR Review Loop — GitHub webhook → AI analysis (security + code smells) → inline comments + summary posted to the Pull Request on GitHub.

**Architecture:** Single repository, two Railway services. Service 1 (Next.js) receives webhooks and enqueues jobs. Service 2 (BullMQ Worker) runs the AI pipeline and posts GitHub comments. Both share PostgreSQL, Redis, Prisma, and the AI provider abstraction.

**Tech Stack:** Next.js 15, TypeScript (strict), PostgreSQL + Prisma 5, Redis + BullMQ 5, NextAuth.js v5 (beta), Claude `claude-sonnet-4-6` via `@anthropic-ai/sdk`, `@octokit/rest` + `@octokit/auth-app`, Zod, pino, vitest.

## Global Constraints

- Node.js ≥ 20.x; TypeScript strict mode
- All path imports use `@/` alias mapped to `./src`
- All Claude responses validated with Zod — raw AI output is never accepted
- Status transitions: `PENDING→PROCESSING→COMPLETED` or `PENDING→PROCESSING→FAILED` only; all others throw
- Confidence thresholds: ≥ 0.85 → published to GitHub; 0.70–0.84 → saved-only; < 0.70 → discarded
- Deduplication key: `filePath + lineStart + title` — keep highest confidence on clash
- `Finding.suggestion` is non-nullable — every finding must include a concrete fix
- BullMQ `jobId` equals `reviewId` — prevents duplicate enqueue for same review
- Worker concurrency: 3; job timeout: 5 min; attempts: 3; backoff: exponential from 5s

---

## Phase 1: Project Foundation

**Objectives:** Bootstrapped Next.js 15 app, complete Prisma schema, core utilities (logger, crypto, db, redis), vitest passing.

**Database changes:** All tables created via initial migration.

**API changes:** None yet.

### Files Created

```
package.json (scripts updated)
vitest.config.ts
.env.example
prisma/schema.prisma
src/lib/logger.ts
src/lib/crypto.ts
src/lib/db.ts
src/lib/redis.ts
src/lib/crypto.test.ts
```

---

### Task 1.1: Scaffold Next.js App and Install Dependencies

- [ ] **Create the app**

```bash
npx create-next-app@15 . \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --no-git
```

- [ ] **Install runtime dependencies**

```bash
npm install \
  prisma@^5 @prisma/client@^5 \
  bullmq@^5 ioredis@^5 \
  next-auth@beta \
  @anthropic-ai/sdk \
  "@octokit/rest@^20" "@octokit/auth-app@^7" \
  zod@^3 \
  pino@^9 pino-pretty@^11 \
  jsonwebtoken@^9
```

- [ ] **Install dev dependencies**

```bash
npm install -D @types/jsonwebtoken vitest@^1 tsx@^4
```

- [ ] **Add scripts to `package.json`** (merge into existing `scripts` block)

```json
{
  "scripts": {
    "worker": "tsx src/worker/index.ts",
    "worker:dev": "tsx watch src/worker/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push"
  }
}
```

- [ ] **Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: { globals: true, environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
```

- [ ] **Verify `tsconfig.json` has strict mode and path alias** — confirm these keys exist:

```json
{
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Init Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

- [ ] **Init shadcn/ui**

```bash
npx shadcn@latest init --defaults
npx shadcn@latest add button badge card separator skeleton avatar
```

- [ ] **Create `.env.example`**

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_code_review

# Redis
REDIS_URL=redis://localhost:6379

# NextAuth
AUTH_SECRET=generate-with-openssl-rand-base64-32
AUTH_URL=http://localhost:3000

# GitHub OAuth App (for user login)
AUTH_GITHUB_ID=your-oauth-app-client-id
AUTH_GITHUB_SECRET=your-oauth-app-client-secret

# GitHub App (for webhooks + repo access + comment posting)
GITHUB_APP_ID=your-app-id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_APP_CLIENT_ID=your-app-client-id
GITHUB_APP_CLIENT_SECRET=your-app-client-secret

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Token encryption (32-byte hex — generate with: openssl rand -hex 32)
ENCRYPTION_KEY=your-64-char-hex-string
```

- [ ] **Copy `.env.example` to `.env.local`** and fill in real values for local dev

---

### Task 1.2: Prisma Schema

- [ ] **Replace `prisma/schema.prisma` with the full schema**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String         @id @default(cuid())
  githubId      Int            @unique
  login         String
  email         String?
  avatarUrl     String?
  accessToken   String
  installations Installation[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

model Installation {
  id              String       @id @default(cuid())
  githubInstallId Int          @unique
  accountLogin    String
  accountType     String
  active          Boolean      @default(true)
  userId          String
  user            User         @relation(fields: [userId], references: [id])
  repositories    Repository[]
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
}

model Repository {
  id             String        @id @default(cuid())
  githubRepoId   Int           @unique
  fullName       String
  private        Boolean       @default(false)
  installationId String
  installation   Installation  @relation(fields: [installationId], references: [id])
  pullRequests   PullRequest[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
}

model PullRequest {
  id              String      @id @default(cuid())
  githubPrId      Int
  number          Int
  title           String
  authorLogin     String
  state           String
  headSha         String
  headBranch      String
  baseBranch      String
  lastReviewedSha String?
  repositoryId    String
  repository      Repository  @relation(fields: [repositoryId], references: [id])
  reviews         Review[]
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@unique([repositoryId, githubPrId])
}

model Review {
  id              String       @id @default(cuid())
  pullRequestId   String
  pullRequest     PullRequest  @relation(fields: [pullRequestId], references: [id])
  status          ReviewStatus @default(PENDING)
  processingStage String?
  securityScore   Int?
  qualityScore    Int?
  findingsCount   Int          @default(0)
  githubReviewId  Int?
  findings        Finding[]
  errorMessage    String?
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
}

enum ReviewStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model Finding {
  id              String          @id @default(cuid())
  reviewId        String
  review          Review          @relation(fields: [reviewId], references: [id])
  category        FindingCategory
  severity        FindingSeverity
  title           String
  description     String
  suggestion      String
  filePath        String
  lineStart       Int
  lineEnd         Int?
  confidence      Float
  published       Boolean         @default(false)
  githubCommentId Int?
  createdAt       DateTime        @default(now())
}

enum FindingCategory {
  SECURITY
  CODE_SMELL
}

enum FindingSeverity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
  INFO
}

model WebhookDelivery {
  id               String        @id @default(cuid())
  githubDeliveryId String        @unique
  event            String
  action           String?
  payload          Json
  signature        String
  status           WebhookStatus @default(RECEIVED)
  reviewId         String?
  errorMessage     String?
  receivedAt       DateTime      @default(now())
  processedAt      DateTime?
}

enum WebhookStatus {
  RECEIVED
  ENQUEUED
  IGNORED
  FAILED
}
```

- [ ] **Run migration**

```bash
npx prisma migrate dev --name init
```

Expected: Migration created and applied. Prisma Client regenerated.

- [ ] **Verify**

```bash
npx prisma studio
```

Expected: All 7 tables visible (User, Installation, Repository, PullRequest, Review, Finding, WebhookDelivery).

---

### Task 1.3: Core Utilities

- [ ] **Create `src/lib/logger.ts`**

```typescript
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
})
```

- [ ] **Create `src/lib/crypto.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

export function encrypt(text: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(encryptedText: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const [ivHex, authTagHex, encryptedHex] = encryptedText.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
```

- [ ] **Create `src/lib/db.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Create `src/lib/redis.ts`**

```typescript
import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as { redis: Redis }

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null, // required by BullMQ
  })

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis
```

- [ ] **Write test `src/lib/crypto.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt } from './crypto'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64) // 32-byte hex for test
})

describe('encrypt / decrypt', () => {
  it('roundtrips a string', () => {
    const original = 'github_pat_abc123'
    expect(decrypt(encrypt(original))).toBe(original)
  })

  it('produces different ciphertext each call', () => {
    const a = encrypt('same')
    const b = encrypt('same')
    expect(a).not.toBe(b)
  })

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('secret')
    const tampered = encrypted.slice(0, -4) + 'xxxx'
    expect(() => decrypt(tampered)).toThrow()
  })
})
```

- [ ] **Run tests**

```bash
npm test
```

Expected: 3 tests pass.

---

### Phase 1 Verification

```bash
npm test              # crypto tests pass
npx prisma db pull    # schema matches local DB
```

---

## Phase 2: AI Review Engine

**Objectives:** AI provider interface, Zod validation schemas, Claude implementation. All Claude responses are validated before use. Tests pass with mocked Anthropic client.

**Database changes:** None.

**API changes:** None.

### Files Created

```
src/lib/ai/types.ts
src/lib/ai/provider.ts
src/lib/ai/schemas.ts
src/lib/ai/providers/claude.ts
src/lib/ai/index.ts
src/lib/ai/schemas.test.ts
src/lib/ai/providers/claude.test.ts
```

---

### Task 2.1: Types and Interface

- [ ] **Create `src/lib/ai/types.ts`**

```typescript
export interface DiffFile {
  path: string
  patch: string
  additions: number
  deletions: number
  language: string
}

export interface PullRequestDiff {
  files: DiffFile[]
  prTitle: string
  prDescription: string
  repoFullName: string
  baseBranch: string
  headBranch: string
}

export interface ReviewContext {
  repoFullName: string
  prSize: 'small' | 'medium' | 'large'
  fileCount: number
  languages: string[]
}

export interface AIFinding {
  category: 'SECURITY' | 'CODE_SMELL'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  title: string
  description: string
  suggestion: string
  filePath: string
  lineStart: number
  lineEnd?: number
  confidence: number
}

export interface ReviewSummary {
  securityScore: number
  qualityScore: number
  recommendedActions: string[]
}
```

- [ ] **Create `src/lib/ai/provider.ts`**

```typescript
import type { PullRequestDiff, AIFinding, ReviewSummary, ReviewContext } from './types'

export interface AIProvider {
  healthCheck(): Promise<boolean>
  analyzeSecurity(diff: PullRequestDiff): Promise<AIFinding[]>
  analyzeCodeSmells(diff: PullRequestDiff): Promise<AIFinding[]>
  generateSummary(
    findings: AIFinding[],
    diff: PullRequestDiff,
    context: ReviewContext
  ): Promise<ReviewSummary>
}
```

---

### Task 2.2: Zod Schemas

- [ ] **Create `src/lib/ai/schemas.ts`**

```typescript
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
```

- [ ] **Write test `src/lib/ai/schemas.test.ts`**

```typescript
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
```

- [ ] **Run tests — expect 6 pass**

```bash
npm test
```

---

### Task 2.3: Claude Provider

- [ ] **Create `src/lib/ai/providers/claude.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, PullRequestDiff, AIFinding, ReviewSummary, ReviewContext } from '../types'
import { findingsSchema, summarySchema } from '../schemas'

const MODEL = 'claude-sonnet-4-6'

export class ClaudeProvider implements AIProvider {
  private client: Anthropic

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return true
    } catch {
      return false
    }
  }

  async analyzeSecurity(diff: PullRequestDiff): Promise<AIFinding[]> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: `You are a security code reviewer. Analyze only the changed lines in the diff below.
Return a JSON array of security vulnerabilities. Only report findings you are highly confident are real issues.
Return [] if nothing qualifies. Never speculate. Never report style issues.

Each object must have: category ("SECURITY"), severity ("CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"INFO"),
title (string), description (string — why it's a problem), suggestion (string — concrete fix, required),
filePath (string), lineStart (integer), lineEnd (integer, optional), confidence (float 0.0–1.0).`,
      messages: [{ role: 'user', content: this.formatDiff(diff) }],
    })

    return findingsSchema.parse(this.extractJSON(this.getText(response)))
  }

  async analyzeCodeSmells(diff: PullRequestDiff): Promise<AIFinding[]> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: `You are a code quality reviewer. Analyze only the changed lines in the diff below.
Return a JSON array of code smell findings (e.g. long functions, high complexity, unclear naming, duplication).
Only report findings you are highly confident are real issues. Return [] if nothing qualifies.

Each object must have: category ("CODE_SMELL"), severity ("CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"INFO"),
title (string), description (string — why it's a problem), suggestion (string — concrete fix, required),
filePath (string), lineStart (integer), lineEnd (integer, optional), confidence (float 0.0–1.0).`,
      messages: [{ role: 'user', content: this.formatDiff(diff) }],
    })

    return findingsSchema.parse(this.extractJSON(this.getText(response)))
  }

  async generateSummary(
    findings: AIFinding[],
    diff: PullRequestDiff,
    context: ReviewContext
  ): Promise<ReviewSummary> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: `You are a code review summarizer. Given a list of findings from a PR review, produce scores and recommendations.
Return JSON with: securityScore (0–100 integer, 100 = no issues), qualityScore (0–100 integer),
recommendedActions (array of 1–5 concise action strings).`,
      messages: [{
        role: 'user',
        content: `Findings: ${JSON.stringify(findings)}\nRepo: ${context.repoFullName}\nFiles: ${context.fileCount}\nLanguages: ${context.languages.join(', ')}`,
      }],
    })

    return summarySchema.parse(this.extractJSON(this.getText(response)))
  }

  private getText(response: Anthropic.Message): string {
    const block = response.content[0]
    return block.type === 'text' ? block.text : ''
  }

  private formatDiff(diff: PullRequestDiff): string {
    const files = diff.files.map(f =>
      `=== File: ${f.path} (${f.language}) ===\n${f.patch}`
    ).join('\n\n')
    return `PR: ${diff.prTitle}\nRepo: ${diff.repoFullName} (${diff.baseBranch} ← ${diff.headBranch})\n\n${files}`
  }

  private extractJSON(text: string): unknown {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlock) return JSON.parse(codeBlock[1].trim())
    const inline = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (inline) return JSON.parse(inline[1])
    return JSON.parse(text.trim())
  }
}
```

- [ ] **Create `src/lib/ai/index.ts`**

```typescript
import { ClaudeProvider } from './providers/claude'
import type { AIProvider } from './provider'

export function getAIProvider(): AIProvider {
  return new ClaudeProvider()
}

export type { AIProvider } from './provider'
export type { AIFinding, PullRequestDiff, ReviewSummary, ReviewContext, DiffFile } from './types'
```

- [ ] **Write test `src/lib/ai/providers/claude.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeProvider } from './claude'

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '[]' }],
        }),
      }
    },
  }
})

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    provider = new ClaudeProvider()
  })

  it('analyzeSecurity returns empty array when Claude returns []', async () => {
    const diff = {
      files: [], prTitle: 'Test PR', prDescription: '',
      repoFullName: 'owner/repo', baseBranch: 'main', headBranch: 'feature',
    }
    const result = await provider.analyzeSecurity(diff)
    expect(result).toEqual([])
  })

  it('analyzeCodeSmells returns empty array when Claude returns []', async () => {
    const diff = {
      files: [], prTitle: 'Test PR', prDescription: '',
      repoFullName: 'owner/repo', baseBranch: 'main', headBranch: 'feature',
    }
    const result = await provider.analyzeCodeSmells(diff)
    expect(result).toEqual([])
  })

  it('throws when Claude returns invalid JSON', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as any
    const instance = new Anthropic()
    instance.messages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json' }],
    })
    provider = new ClaudeProvider()
    const diff = {
      files: [], prTitle: 'T', prDescription: '',
      repoFullName: 'o/r', baseBranch: 'main', headBranch: 'feat',
    }
    await expect(provider.analyzeSecurity(diff)).rejects.toThrow()
  })
})
```

- [ ] **Run tests**

```bash
npm test
```

Expected: All tests pass (crypto + schemas + claude provider).

---

### Phase 2 Verification

```bash
npm test   # all tests pass
npx tsc --noEmit   # no TypeScript errors
```

---

## Phase 3: GitHub Integration Layer

**Objectives:** GitHub App authentication (JWT + installation tokens), webhook signature validation, PR diff fetcher, GitHub Reviews API client. Tests pass without real GitHub credentials.

**Database changes:** None.

**API changes:** None (these are library utilities, not HTTP routes).

### Files Created

```
src/lib/github/app.ts
src/lib/github/webhook.ts
src/lib/github/diff.ts
src/lib/github/review.ts
src/lib/github/types.ts
src/lib/github/webhook.test.ts
src/lib/github/diff.test.ts
src/lib/github/review.test.ts
```

---

### Task 3.1: GitHub App Authentication

- [ ] **Create `src/lib/github/app.ts`**

```typescript
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

function getAppAuth() {
  return {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  }
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const auth = createAppAuth(getAppAuth())
  const { token } = await auth({ type: 'installation', installationId })
  return token
}

export function getAppOctokit(): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: getAppAuth(),
  })
}

export function getInstallationOctokit(token: string): Octokit {
  return new Octokit({ auth: token })
}
```

---

### Task 3.2: Webhook Signature Validation

- [ ] **Create `src/lib/github/webhook.ts`**

```typescript
import { createHmac, timingSafeEqual } from 'crypto'

export function validateWebhookSignature(
  body: Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}
```

- [ ] **Write test `src/lib/github/webhook.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { validateWebhookSignature } from './webhook'

const SECRET = 'test-secret'

function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

describe('validateWebhookSignature', () => {
  it('accepts a valid signature', () => {
    const body = Buffer.from('{"action":"opened"}')
    expect(validateWebhookSignature(body, sign(body), SECRET)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    const body = Buffer.from('{"action":"opened"}')
    expect(validateWebhookSignature(body, 'sha256=deadbeef', SECRET)).toBe(false)
  })

  it('rejects a missing sha256= prefix', () => {
    const body = Buffer.from('payload')
    expect(validateWebhookSignature(body, 'badhash', SECRET)).toBe(false)
  })

  it('rejects a tampered body', () => {
    const body = Buffer.from('original')
    const sig = sign(body)
    const tampered = Buffer.from('modified')
    expect(validateWebhookSignature(tampered, sig, SECRET)).toBe(false)
  })
})
```

---

### Task 3.3: PR Diff Fetcher

- [ ] **Create `src/lib/github/types.ts`**

```typescript
export interface PullRequestWebhookPayload {
  action: string
  pull_request: {
    id: number
    number: number
    title: string
    body: string | null
    state: string
    head: { sha: string; ref: string }
    base: { sha: string; ref: string }
    user: { login: string }
  }
  repository: {
    id: number
    full_name: string
    name: string
    owner: { login: string }
    private: boolean
  }
  installation: { id: number }
}

export interface InstallationWebhookPayload {
  action: string
  installation: {
    id: number
    account: { login: string; type: string }
  }
  repositories?: Array<{ id: number; full_name: string; private: boolean; name: string }>
}
```

- [ ] **Create `src/lib/github/diff.ts`**

```typescript
import { Octokit } from '@octokit/rest'
import type { PullRequestDiff, DiffFile } from '@/lib/ai/types'

const MAX_PATCH_LINES = 8000

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', java: 'java', cs: 'csharp',
  php: 'php', rs: 'rust', cpp: 'cpp', c: 'c', swift: 'swift', kt: 'kotlin',
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_MAP[ext] ?? 'unknown'
}

export async function fetchPRDiff(params: {
  token: string
  owner: string
  repo: string
  prNumber: number
  prTitle: string
  prDescription: string
  baseBranch: string
  headBranch: string
}): Promise<{ diff: PullRequestDiff; truncated: boolean }> {
  const octokit = new Octokit({ auth: params.token })

  const { data: files } = await octokit.pulls.listFiles({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    per_page: 100,
  })

  const sorted = [...files].sort((a, b) => b.additions - a.additions)

  const diffFiles: DiffFile[] = []
  let totalLines = 0
  let truncated = false

  for (const file of sorted) {
    if (!file.patch) continue
    const lines = file.patch.split('\n').length
    if (totalLines + lines > MAX_PATCH_LINES) {
      truncated = true
      break
    }
    totalLines += lines
    diffFiles.push({
      path: file.filename,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      language: detectLanguage(file.filename),
    })
  }

  return {
    diff: {
      files: diffFiles,
      prTitle: params.prTitle,
      prDescription: params.prDescription ?? '',
      repoFullName: `${params.owner}/${params.repo}`,
      baseBranch: params.baseBranch,
      headBranch: params.headBranch,
    },
    truncated,
  }
}
```

- [ ] **Write test `src/lib/github/diff.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { fetchPRDiff } from './diff'

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    pulls = {
      listFiles: vi.fn().mockResolvedValue({
        data: [
          { filename: 'src/auth.ts', patch: '+const x = 1', additions: 1, deletions: 0 },
          { filename: 'README.md', patch: '+# Title', additions: 1, deletions: 0 },
        ],
      }),
    }
  },
}))

describe('fetchPRDiff', () => {
  it('builds a PullRequestDiff from GitHub API response', async () => {
    const { diff, truncated } = await fetchPRDiff({
      token: 'tok', owner: 'owner', repo: 'repo', prNumber: 1,
      prTitle: 'My PR', prDescription: '', baseBranch: 'main', headBranch: 'feat',
    })
    expect(diff.files).toHaveLength(2)
    expect(diff.files[0].path).toBe('src/auth.ts')
    expect(diff.files[0].language).toBe('typescript')
    expect(diff.repoFullName).toBe('owner/repo')
    expect(truncated).toBe(false)
  })

  it('skips files without a patch', async () => {
    const { Octokit } = await import('@octokit/rest') as any
    new Octokit().pulls.listFiles.mockResolvedValueOnce({
      data: [{ filename: 'binary.png', patch: undefined, additions: 0, deletions: 0 }],
    })
    const { diff } = await fetchPRDiff({
      token: 'tok', owner: 'o', repo: 'r', prNumber: 1,
      prTitle: 'T', prDescription: '', baseBranch: 'main', headBranch: 'feat',
    })
    expect(diff.files).toHaveLength(0)
  })
})
```

---

### Task 3.4: GitHub Review Publisher

- [ ] **Create `src/lib/github/review.ts`**

```typescript
import { Octokit } from '@octokit/rest'
import type { AIFinding, ReviewSummary } from '@/lib/ai/types'

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: '🚨', HIGH: '⚠️', MEDIUM: '🔶', LOW: '🔵', INFO: 'ℹ️',
}

function formatFindingBody(finding: AIFinding): string {
  const emoji = SEVERITY_EMOJI[finding.severity]
  return `${emoji} **[${finding.severity} — ${finding.category.replace('_', ' ')}]** ${finding.title}

${finding.description}

**Suggested fix:** ${finding.suggestion}

*Confidence: ${Math.round(finding.confidence * 100)}%*`
}

function formatSummaryBody(summary: ReviewSummary, findings: AIFinding[], truncated: boolean): string {
  const bySeverity = (s: string) => findings.filter(f => f.severity === s).length
  const byCategory = (c: string) => findings.filter(f => f.category === c)

  const secFindings = byCategory('SECURITY')
  const smellFindings = byCategory('CODE_SMELL')

  const secSection = secFindings.length
    ? `### Security\n${secFindings.map(f => `- **${f.title}** — \`${f.filePath}:${f.lineStart}\``).join('\n')}`
    : ''

  const smellSection = smellFindings.length
    ? `### Code Smell\n${smellFindings.map(f => `- **${f.title}** — \`${f.filePath}:${f.lineStart}\``).join('\n')}`
    : ''

  const truncatedNote = truncated
    ? '\n> ⚠️ **Note:** This PR was too large to analyze in full. Results cover the highest-impact files.\n'
    : ''

  return `## 🤖 AI Code Review Summary
${truncatedNote}
| Metric | Score |
|--------|-------|
| 🔒 Security | ${summary.securityScore}/100 |
| ✨ Code Quality | ${summary.qualityScore}/100 |

### Findings

| Severity | Count |
|----------|-------|
| 🚨 Critical | ${bySeverity('CRITICAL')} |
| ⚠️ High | ${bySeverity('HIGH')} |
| 🔶 Medium | ${bySeverity('MEDIUM')} |

${secSection}

${smellSection}

### Recommended Actions
${summary.recommendedActions.map(a => `- ${a}`).join('\n')}

---
*Powered by AI Code Review*`
}

export async function publishGitHubReview(params: {
  token: string
  owner: string
  repo: string
  prNumber: number
  headSha: string
  publishableFindings: AIFinding[]
  summary: ReviewSummary
  allFindings: AIFinding[]
  truncated: boolean
}): Promise<number> {
  const octokit = new Octokit({ auth: params.token })

  const comments = params.publishableFindings.map(f => ({
    path: f.filePath,
    line: f.lineStart,
    body: formatFindingBody(f),
  }))

  const { data } = await octokit.pulls.createReview({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
    commit_id: params.headSha,
    event: 'COMMENT',
    body: formatSummaryBody(params.summary, params.allFindings, params.truncated),
    comments,
  })

  return data.id
}
```

- [ ] **Write test `src/lib/github/review.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { publishGitHubReview } from './review'

const mockCreateReview = vi.fn().mockResolvedValue({ data: { id: 42 } })

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    pulls = { createReview: mockCreateReview }
  },
}))

describe('publishGitHubReview', () => {
  it('returns the GitHub review ID', async () => {
    const id = await publishGitHubReview({
      token: 'tok', owner: 'o', repo: 'r', prNumber: 1,
      headSha: 'abc123',
      publishableFindings: [],
      summary: { securityScore: 90, qualityScore: 85, recommendedActions: ['Fix XSS'] },
      allFindings: [],
      truncated: false,
    })
    expect(id).toBe(42)
  })

  it('maps findings to GitHub inline comments', async () => {
    await publishGitHubReview({
      token: 'tok', owner: 'o', repo: 'r', prNumber: 1,
      headSha: 'abc',
      publishableFindings: [{
        category: 'SECURITY', severity: 'CRITICAL', title: 'XSS',
        description: 'Unescaped output', suggestion: 'Use escaping',
        filePath: 'src/render.ts', lineStart: 10, confidence: 0.95,
      }],
      summary: { securityScore: 50, qualityScore: 80, recommendedActions: ['Escape output'] },
      allFindings: [],
      truncated: false,
    })
    const call = mockCreateReview.mock.calls[mockCreateReview.mock.calls.length - 1][0]
    expect(call.comments[0].path).toBe('src/render.ts')
    expect(call.comments[0].line).toBe(10)
  })
})
```

- [ ] **Run all tests**

```bash
npm test
```

Expected: All tests pass (crypto + AI schemas + claude + webhook + diff + review).

---

### Phase 3 Verification

```bash
npm test
npx tsc --noEmit
```

---

## Phase 4: Job Queue & Worker Pipeline

**Objectives:** BullMQ queue definition, analysis pipeline stages (dedup, confidence gate), full `processAnalyzePR` processor, worker entry point with startup recovery. At the end of this phase the worker can process a job end-to-end with mocked dependencies.

**Database changes:** None (schema already created in Phase 1).

**API changes:** None.

### Files Created

```
src/lib/queue.ts
src/worker/pipeline/deduplicate.ts
src/worker/pipeline/confidence-gate.ts
src/worker/processors/analyze-pr.ts
src/worker/index.ts
src/worker/pipeline/deduplicate.test.ts
src/worker/pipeline/confidence-gate.test.ts
```

---

### Task 4.1: Queue Definition

- [ ] **Create `src/lib/queue.ts`**

```typescript
import { Queue } from 'bullmq'
import { redis } from './redis'

export const PR_ANALYSIS_QUEUE = 'pr-analysis'

// Reserved for future phases — do not use yet:
// export const PR_CHUNK_QUEUE = 'analyze-pr-chunk'
// export const PUBLISH_QUEUE = 'publish-review'

export interface AnalyzePRJobData {
  reviewId: string
  pullRequestId: string
  installationId: number
  owner: string
  repo: string
  prNumber: number
  headSha: string
  baseSha: string
  headBranch: string
  baseBranch: string
}

export const prAnalysisQueue = new Queue<AnalyzePRJobData>(PR_ANALYSIS_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    timeout: 300_000,
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 604_800 },
  },
})

export async function enqueueReviewJob(data: AnalyzePRJobData): Promise<void> {
  await prAnalysisQueue.add('analyze-pr', data, { jobId: data.reviewId })
}
```

---

### Task 4.2: Pipeline Stages

- [ ] **Create `src/worker/pipeline/deduplicate.ts`**

```typescript
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
```

- [ ] **Write test `src/worker/pipeline/deduplicate.test.ts`**

```typescript
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
```

- [ ] **Create `src/worker/pipeline/confidence-gate.ts`**

```typescript
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
```

- [ ] **Write test `src/worker/pipeline/confidence-gate.test.ts`**

```typescript
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
```

- [ ] **Run tests**

```bash
npm test
```

Expected: All pipeline tests pass.

---

### Task 4.3: PR Analysis Processor

- [ ] **Create `src/worker/processors/analyze-pr.ts`**

```typescript
import type { Job } from 'bullmq'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getInstallationToken } from '@/lib/github/app'
import { fetchPRDiff } from '@/lib/github/diff'
import { publishGitHubReview } from '@/lib/github/review'
import { getAIProvider } from '@/lib/ai'
import { deduplicateFindings } from '../pipeline/deduplicate'
import { applyConfidenceGate } from '../pipeline/confidence-gate'
import type { AnalyzePRJobData } from '@/lib/queue'
import type { ReviewContext } from '@/lib/ai/types'

async function setStage(reviewId: string, stage: string | null) {
  await prisma.review.update({
    where: { id: reviewId },
    data: { processingStage: stage },
  })
}

export async function processAnalyzePR(job: Job<AnalyzePRJobData>): Promise<void> {
  const { reviewId, pullRequestId, installationId, owner, repo, prNumber, headSha, baseSha, headBranch, baseBranch } = job.data
  const log = logger.child({ reviewId, jobId: job.id })

  // Guard: skip if already reviewed
  const pr = await prisma.pullRequest.findUnique({ where: { id: pullRequestId } })
  if (pr?.lastReviewedSha === headSha) {
    log.info('Skipping: commit already reviewed')
    return
  }

  // Transition: PENDING → PROCESSING
  const review = await prisma.review.findUnique({ where: { id: reviewId } })
  if (review?.status !== 'PENDING') {
    throw new Error(`Invalid status transition: ${review?.status} → PROCESSING`)
  }
  await prisma.review.update({
    where: { id: reviewId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  })

  try {
    // Stage 1: Fetch diff
    await setStage(reviewId, 'FETCHING_DIFF')
    const token = await getInstallationToken(installationId)
    const pullRequest = await prisma.pullRequest.findUniqueOrThrow({ where: { id: pullRequestId } })
    const { diff, truncated } = await fetchPRDiff({
      token, owner, repo, prNumber,
      prTitle: pullRequest.title,
      prDescription: '',
      baseBranch,
      headBranch,
    })

    // Stage 2: Parallel AI analysis
    await setStage(reviewId, 'SECURITY_ANALYSIS')
    const provider = getAIProvider()
    const [securityFindings, codeSmellFindings] = await Promise.all([
      provider.analyzeSecurity(diff),
      provider.analyzeCodeSmells(diff),
    ])

    // Merge → deduplicate → confidence gate
    const merged = [...securityFindings, ...codeSmellFindings]
    const deduped = deduplicateFindings(merged)
    const { publishable, savedOnly } = applyConfidenceGate(deduped)
    const toSave = [...publishable, ...savedOnly]

    // Save findings to DB
    if (toSave.length > 0) {
      await prisma.finding.createMany({
        data: toSave.map(f => ({
          reviewId,
          category: f.category,
          severity: f.severity,
          title: f.title,
          description: f.description,
          suggestion: f.suggestion,
          filePath: f.filePath,
          lineStart: f.lineStart,
          lineEnd: f.lineEnd ?? null,
          confidence: f.confidence,
          published: publishable.includes(f),
        })),
      })
    }

    // Stage 3: Generate summary
    await setStage(reviewId, 'GENERATING_SUMMARY')
    const context: ReviewContext = {
      repoFullName: `${owner}/${repo}`,
      prSize: diff.files.length < 5 ? 'small' : diff.files.length < 20 ? 'medium' : 'large',
      fileCount: diff.files.length,
      languages: [...new Set(diff.files.map(f => f.language))],
    }
    const summary = await provider.generateSummary(publishable, diff, context)

    // Stage 4: Publish to GitHub
    await setStage(reviewId, 'PUBLISHING')
    let githubReviewId: number | null = null
    try {
      githubReviewId = await publishGitHubReview({
        token, owner, repo, prNumber, headSha,
        publishableFindings: publishable,
        summary,
        allFindings: publishable,
        truncated,
      })
    } catch (publishError) {
      // Analysis work is already saved — mark FAILED but don't rethrow
      await prisma.review.update({
        where: { id: reviewId },
        data: {
          status: 'FAILED',
          errorMessage: `GitHub publish failed: ${publishError instanceof Error ? publishError.message : 'Unknown'}`,
          processingStage: null,
        },
      })
      log.error({ err: publishError }, 'GitHub publish failed — analysis saved')
      return
    }

    // Transition: PROCESSING → COMPLETED
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        status: 'COMPLETED',
        processingStage: null,
        securityScore: summary.securityScore,
        qualityScore: summary.qualityScore,
        findingsCount: publishable.length,
        githubReviewId,
        completedAt: new Date(),
      },
    })

    await prisma.pullRequest.update({
      where: { id: pullRequestId },
      data: { lastReviewedSha: headSha },
    })

    log.info({
      securityScore: summary.securityScore,
      qualityScore: summary.qualityScore,
      findings: publishable.length,
      truncated,
    }, 'Review completed')

  } catch (error) {
    log.error({ err: error }, 'Review pipeline failed')
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        status: 'FAILED',
        processingStage: null,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    })
    throw error // Re-throw so BullMQ retries
  }
}
```

---

### Task 4.4: Worker Entry Point

- [ ] **Create `src/worker/index.ts`**

```typescript
import { Worker } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { PR_ANALYSIS_QUEUE } from '@/lib/queue'
import { processAnalyzePR } from './processors/analyze-pr'

async function recoverStuckReviews(): Promise<void> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000)
  const stuck = await prisma.review.findMany({
    where: { status: 'PROCESSING', startedAt: { lt: cutoff } },
    select: { id: true },
  })

  if (stuck.length > 0) {
    logger.warn({ count: stuck.length }, 'Recovering stuck reviews')
    await prisma.review.updateMany({
      where: { id: { in: stuck.map(r => r.id) } },
      data: { status: 'FAILED', errorMessage: 'Worker interrupted', processingStage: null },
    })
  }
}

async function main() {
  logger.info('Worker starting up')

  await recoverStuckReviews()

  const worker = new Worker(PR_ANALYSIS_QUEUE, processAnalyzePR, {
    connection: redis,
    concurrency: 3,
  })

  worker.on('completed', job => {
    logger.info({ jobId: job.id }, 'Job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Job failed')
  })

  logger.info('Worker ready — listening for jobs')

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — shutting down')
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
  })
}

main().catch(err => {
  logger.error({ err }, 'Worker crashed on startup')
  process.exit(1)
})
```

- [ ] **Run all tests**

```bash
npm test
```

Expected: All tests still pass.

- [ ] **Verify worker compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

---

### Phase 4 Verification

```bash
npm test
npx tsc --noEmit
# With real Redis running:
npm run worker:dev   # Should log "Worker ready — listening for jobs"
```

---

## Phase 5: Webhook Handler

**Objectives:** `POST /api/webhooks/github` route. Validates HMAC signature, routes events, creates Review records, enqueues jobs. Returns 200 for all valid requests.

**Database changes:** Creates WebhookDelivery, Repository, PullRequest, Review records on `pull_request` events. Updates Installation on `installation` events.

**API changes:** `POST /api/webhooks/github`

### Files Created

```
src/app/api/webhooks/github/route.ts
src/app/api/webhooks/github/route.test.ts
```

---

### Task 5.1: Webhook Route

- [ ] **Create `src/app/api/webhooks/github/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { validateWebhookSignature } from '@/lib/github/webhook'
import { enqueueReviewJob } from '@/lib/queue'
import type { PullRequestWebhookPayload, InstallationWebhookPayload } from '@/lib/github/types'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = Buffer.from(await request.arrayBuffer())
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const event = request.headers.get('x-github-event') ?? ''
  const deliveryId = request.headers.get('x-github-delivery') ?? crypto.randomUUID()

  if (!validateWebhookSignature(rawBody, signature, process.env.GITHUB_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(rawBody.toString('utf8'))

  const delivery = await prisma.webhookDelivery.create({
    data: {
      githubDeliveryId: deliveryId,
      event,
      action: payload.action ?? null,
      payload,
      signature,
      status: 'RECEIVED',
    },
  })

  try {
    await routeEvent(event, payload, delivery.id)
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { processedAt: new Date() },
    })
  } catch (error) {
    logger.error({ error, deliveryId }, 'Webhook routing failed')
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown',
        processedAt: new Date(),
      },
    })
  }

  return NextResponse.json({ ok: true })
}

async function routeEvent(event: string, payload: unknown, deliveryId: string): Promise<void> {
  if (event === 'pull_request') {
    await handlePullRequest(payload as PullRequestWebhookPayload, deliveryId)
  } else if (event === 'installation') {
    await handleInstallation(payload as InstallationWebhookPayload, deliveryId)
  } else if (event === 'installation_repositories') {
    await handleInstallationRepositories(payload as InstallationWebhookPayload, deliveryId)
  } else {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
  }
}

async function handlePullRequest(
  payload: PullRequestWebhookPayload,
  deliveryId: string
): Promise<void> {
  const { action, pull_request: pr, repository, installation } = payload

  if (!['opened', 'synchronize', 'reopened'].includes(action)) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  const installRecord = await prisma.installation.findUnique({
    where: { githubInstallId: installation.id },
  })

  if (!installRecord || !installRecord.active) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  const repo = await prisma.repository.upsert({
    where: { githubRepoId: repository.id },
    update: { fullName: repository.full_name },
    create: {
      githubRepoId: repository.id,
      fullName: repository.full_name,
      private: repository.private,
      installationId: installRecord.id,
    },
  })

  const pullRequest = await prisma.pullRequest.upsert({
    where: { repositoryId_githubPrId: { repositoryId: repo.id, githubPrId: pr.id } },
    update: {
      title: pr.title,
      state: pr.state,
      headSha: pr.head.sha,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
    },
    create: {
      githubPrId: pr.id,
      number: pr.number,
      title: pr.title,
      authorLogin: pr.user.login,
      state: pr.state,
      headSha: pr.head.sha,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      repositoryId: repo.id,
    },
  })

  // Skip if already reviewed this commit
  if (pullRequest.lastReviewedSha === pr.head.sha) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  const review = await prisma.review.create({
    data: { pullRequestId: pullRequest.id, status: 'PENDING' },
  })

  await enqueueReviewJob({
    reviewId: review.id,
    pullRequestId: pullRequest.id,
    installationId: installation.id,
    owner: repository.owner.login,
    repo: repository.name,
    prNumber: pr.number,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
  })

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'ENQUEUED', reviewId: review.id },
  })
}

async function handleInstallation(
  payload: InstallationWebhookPayload,
  deliveryId: string
): Promise<void> {
  const { action, installation } = payload

  if (action === 'deleted') {
    await prisma.installation.updateMany({
      where: { githubInstallId: installation.id },
      data: { active: false },
    })
  }

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'ENQUEUED' },
  })
}

async function handleInstallationRepositories(
  payload: InstallationWebhookPayload,
  deliveryId: string
): Promise<void> {
  const { action, installation, repositories } = payload

  if (!repositories?.length) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  const installRecord = await prisma.installation.findUnique({
    where: { githubInstallId: installation.id },
  })

  if (!installRecord) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IGNORED' },
    })
    return
  }

  if (action === 'added') {
    await Promise.all(
      repositories.map(r =>
        prisma.repository.upsert({
          where: { githubRepoId: r.id },
          update: { fullName: r.full_name, private: r.private },
          create: {
            githubRepoId: r.id,
            fullName: r.full_name,
            private: r.private,
            installationId: installRecord.id,
          },
        })
      )
    )
  } else if (action === 'removed') {
    await prisma.repository.deleteMany({
      where: { githubRepoId: { in: repositories.map(r => r.id) } },
    })
  }

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'ENQUEUED' },
  })
}
```

- [ ] **Write test `src/app/api/webhooks/github/route.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import { POST } from './route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  prisma: {
    webhookDelivery: { create: vi.fn().mockResolvedValue({ id: 'del-1' }), update: vi.fn() },
    installation: { findUnique: vi.fn(), updateMany: vi.fn() },
    repository: { upsert: vi.fn().mockResolvedValue({ id: 'repo-1' }) },
    pullRequest: { upsert: vi.fn().mockResolvedValue({ id: 'pr-1', lastReviewedSha: null }) },
    review: { create: vi.fn().mockResolvedValue({ id: 'rev-1' }) },
  },
}))

vi.mock('@/lib/queue', () => ({ enqueueReviewJob: vi.fn() }))

const SECRET = 'test-secret'

function makeRequest(payload: object, event: string): NextRequest {
  const body = JSON.stringify(payload)
  const sig = `sha256=${createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex')}`
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    body,
    headers: {
      'x-hub-signature-256': sig,
      'x-github-event': event,
      'x-github-delivery': 'delivery-1',
      'content-type': 'application/json',
    },
  })
}

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET
  vi.clearAllMocks()
})

describe('POST /api/webhooks/github', () => {
  it('returns 401 for invalid signature', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body: '{}',
      headers: { 'x-hub-signature-256': 'sha256=bad', 'x-github-event': 'ping' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 200 for unknown events and marks IGNORED', async () => {
    const req = makeRequest({ action: 'labeled' }, 'issues')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('enqueues a job for pull_request opened', async () => {
    const { prisma } = await import('@/lib/db')
    const { enqueueReviewJob } = await import('@/lib/queue')
    ;(prisma.installation.findUnique as any).mockResolvedValue({ id: 'inst-1', active: true })

    const payload = {
      action: 'opened',
      pull_request: {
        id: 1, number: 42, title: 'My PR', body: null, state: 'open',
        head: { sha: 'abc', ref: 'feat' }, base: { sha: 'def', ref: 'main' },
        user: { login: 'dev' },
      },
      repository: { id: 10, full_name: 'o/r', name: 'r', owner: { login: 'o' }, private: false },
      installation: { id: 99 },
    }

    const req = makeRequest(payload, 'pull_request')
    await POST(req)

    expect(enqueueReviewJob).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'rev-1', prNumber: 42 })
    )
  })
})
```

- [ ] **Run tests**

```bash
npm test
```

Expected: All tests pass.

---

### Phase 5 Verification

At this point the core backend is complete. To manually verify end-to-end:
1. Start the Next.js dev server: `npm run dev`
2. Use ngrok to expose localhost: `ngrok http 3000`
3. Set the ngrok URL as the webhook URL in your GitHub App settings
4. Open a PR on a repo with the app installed
5. Check the DB: `npx prisma studio` — should see WebhookDelivery (ENQUEUED) and Review (PENDING)
6. Start the worker: `npm run worker:dev`
7. Watch the worker logs — should see the job complete and GitHub comments appear on the PR

---

## Phase 6: Authentication & Installation

**Objectives:** GitHub OAuth login (NextAuth.js v5), GitHub App installation callback, route middleware protecting `/dashboard` and `/reviews`.

**Database changes:** None.

**API changes:**
- `GET /api/auth/[...nextauth]` — NextAuth handler
- `POST /api/auth/[...nextauth]` — NextAuth handler
- `GET /api/github/callback` — installation callback

### Files Created

```
src/lib/auth.ts
src/types/next-auth.d.ts
src/app/api/auth/[...nextauth]/route.ts
src/app/api/github/callback/route.ts
src/middleware.ts
```

---

### Task 6.1: NextAuth Configuration

- [ ] **Create `src/types/next-auth.d.ts`**

```typescript
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      login: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string
    login?: string
  }
}
```

- [ ] **Create `src/lib/auth.ts`**

```typescript
import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { prisma } from './db'
import { encrypt } from './crypto'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ account, profile }) {
      if (!account?.providerAccountId || !profile) return false

      await prisma.user.upsert({
        where: { githubId: Number(account.providerAccountId) },
        update: {
          login: (profile as { login?: string }).login ?? profile.name ?? '',
          email: profile.email ?? undefined,
          avatarUrl: (profile as { avatar_url?: string }).avatar_url ?? profile.image ?? undefined,
          accessToken: encrypt(account.access_token ?? ''),
        },
        create: {
          githubId: Number(account.providerAccountId),
          login: (profile as { login?: string }).login ?? profile.name ?? '',
          email: profile.email ?? undefined,
          avatarUrl: (profile as { avatar_url?: string }).avatar_url ?? profile.image ?? undefined,
          accessToken: encrypt(account.access_token ?? ''),
        },
      })

      return true
    },

    async jwt({ token, account, profile }) {
      if (account?.providerAccountId) {
        const user = await prisma.user.findUnique({
          where: { githubId: Number(account.providerAccountId) },
          select: { id: true },
        })
        token.userId = user?.id
        token.login = (profile as { login?: string })?.login
      }
      return token
    },

    async session({ session, token }) {
      session.user.id = token.userId as string
      session.user.login = token.login as string
      return session
    },
  },
})
```

- [ ] **Create `src/app/api/auth/[...nextauth]/route.ts`**

```typescript
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

---

### Task 6.2: GitHub App Installation Callback

- [ ] **Create `src/app/api/github/callback/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getAppOctokit, getInstallationToken } from '@/lib/github/app'
import { Octokit } from '@octokit/rest'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const installationId = request.nextUrl.searchParams.get('installation_id')
  if (!installationId) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const numericId = Number(installationId)

  try {
    const appOctokit = getAppOctokit()
    const { data: installation } = await (appOctokit as any).request(
      'GET /app/installations/{installation_id}',
      { installation_id: numericId }
    )

    await prisma.installation.upsert({
      where: { githubInstallId: numericId },
      update: { active: true },
      create: {
        githubInstallId: numericId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        userId: session.user.id,
      },
    })

    // Sync repositories accessible to this installation
    const token = await getInstallationToken(numericId)
    const installOctokit = new Octokit({ auth: token })
    const { data } = await installOctokit.apps.listReposAccessibleToInstallation({ per_page: 100 })

    const installRecord = await prisma.installation.findUniqueOrThrow({
      where: { githubInstallId: numericId },
    })

    await Promise.all(
      data.repositories.map(r =>
        prisma.repository.upsert({
          where: { githubRepoId: r.id },
          update: { fullName: r.full_name, private: r.private },
          create: {
            githubRepoId: r.id,
            fullName: r.full_name,
            private: r.private,
            installationId: installRecord.id,
          },
        })
      )
    )
  } catch (err) {
    console.error('Installation callback error:', err)
  }

  return NextResponse.redirect(new URL('/dashboard', request.url))
}
```

---

### Task 6.3: Route Middleware

- [ ] **Create `src/middleware.ts`**

```typescript
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth(req => {
  const { nextUrl, auth: session } = req as typeof req & { auth: unknown }
  const isLoggedIn = !!session

  const isProtected =
    nextUrl.pathname.startsWith('/dashboard') ||
    nextUrl.pathname.startsWith('/reviews') ||
    nextUrl.pathname.startsWith('/repos')

  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL('/', nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/dashboard/:path*', '/reviews/:path*', '/repos/:path*'],
}
```

---

### Phase 6 Verification

```bash
npm run dev
# Visit http://localhost:3000
# Click "Login with GitHub" — should redirect to GitHub OAuth
# After login, should land at /dashboard (which 404s until Phase 7)
```

---

## Phase 7: Dashboard & Frontend

**Objectives:** All UI pages — landing, dashboard, review detail. Canonical review URL with client-side polling while PROCESSING. "View on GitHub" links on every review page.

**Database changes:** None.

**API changes:** `GET /api/reviews/[reviewId]/status`

### Files Created

```
src/components/providers.tsx
src/components/review-status-badge.tsx
src/components/score-ring.tsx
src/components/finding-card.tsx
src/components/findings-summary.tsx
src/components/processing-progress.tsx
src/components/metrics-cards.tsx
src/components/pr-review-card.tsx
src/app/layout.tsx
src/app/page.tsx
src/app/dashboard/page.tsx
src/app/reviews/[reviewId]/page.tsx
src/app/repos/[owner]/[repo]/pulls/[number]/page.tsx
src/app/api/reviews/[reviewId]/status/route.ts
```

---

### Task 7.1: Root Layout and Providers

- [ ] **Create `src/components/providers.tsx`**

```typescript
'use client'
import { SessionProvider } from 'next-auth/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
```

- [ ] **Replace `src/app/layout.tsx`**

```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AI Code Review',
  description: 'AI-powered code review that catches what humans miss',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

---

### Task 7.2: Status API Endpoint

- [ ] **Create `src/app/api/reviews/[reviewId]/status/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: { reviewId: string } }
): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const review = await prisma.review.findUnique({
    where: { id: params.reviewId },
    select: {
      status: true,
      processingStage: true,
      securityScore: true,
      qualityScore: true,
      findingsCount: true,
      errorMessage: true,
    },
  })

  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(review)
}
```

---

### Task 7.3: UI Components

- [ ] **Create `src/components/review-status-badge.tsx`**

```typescript
import { Badge } from '@/components/ui/badge'

const CONFIG = {
  PENDING:    { label: 'Pending',    className: 'bg-yellow-100 text-yellow-800' },
  PROCESSING: { label: 'Processing', className: 'bg-blue-100 text-blue-800 animate-pulse' },
  COMPLETED:  { label: 'Completed',  className: 'bg-green-100 text-green-800' },
  FAILED:     { label: 'Failed',     className: 'bg-red-100 text-red-800' },
} as const

type Status = keyof typeof CONFIG

export function ReviewStatusBadge({ status }: { status: Status }) {
  const { label, className } = CONFIG[status] ?? CONFIG.PENDING
  return <Badge className={className}>{label}</Badge>
}
```

- [ ] **Create `src/components/score-ring.tsx`**

```typescript
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
```

- [ ] **Create `src/components/findings-summary.tsx`**

```typescript
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
```

- [ ] **Create `src/components/finding-card.tsx`**

```typescript
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
```

- [ ] **Create `src/components/processing-progress.tsx`**

```typescript
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
```

- [ ] **Create `src/components/metrics-cards.tsx`**

```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MetricsCardsProps {
  repoCount: number
  prCount: number
  criticalCount: number
  avgSecurityScore: number | null
}

export function MetricsCards({ repoCount, prCount, criticalCount, avgSecurityScore }: MetricsCardsProps) {
  const metrics = [
    { label: 'Repositories Reviewed', value: repoCount },
    { label: 'Pull Requests Reviewed', value: prCount },
    { label: 'Critical Findings', value: criticalCount },
    { label: 'Avg Security Score', value: avgSecurityScore != null ? `${avgSecurityScore}/100` : '–' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {metrics.map(m => (
        <Card key={m.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{m.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{m.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Create `src/components/pr-review-card.tsx`**

```typescript
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ReviewStatusBadge } from './review-status-badge'
import { FindingsSummary } from './findings-summary'

interface PRReviewCardProps {
  reviewId: string
  prNumber: number
  prTitle: string
  repoFullName: string
  authorLogin: string
  status: string
  securityScore: number | null
  qualityScore: number | null
  criticalCount: number
  highCount: number
  mediumCount: number
}

export function PRReviewCard(props: PRReviewCardProps) {
  const { reviewId, prNumber, prTitle, repoFullName, authorLogin, status,
    securityScore, qualityScore, criticalCount, highCount, mediumCount } = props

  return (
    <Link href={`/reviews/${reviewId}`}>
      <Card className="mb-3 hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground mb-1">
                {repoFullName} #{prNumber}
              </p>
              <p className="font-medium text-sm truncate">{prTitle}</p>
              <p className="text-xs text-muted-foreground mt-1">by @{authorLogin}</p>
            </div>
            <ReviewStatusBadge status={status as any} />
          </div>

          {status === 'COMPLETED' && (
            <div className="mt-3 flex items-center justify-between">
              <FindingsSummary critical={criticalCount} high={highCount} medium={mediumCount} />
              <div className="flex gap-4 text-xs text-muted-foreground">
                {securityScore != null && <span>🔒 {securityScore}</span>}
                {qualityScore != null && <span>✨ {qualityScore}</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
```

---

### Task 7.4: Landing Page

- [ ] **Replace `src/app/page.tsx`**

```typescript
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { auth, signIn } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function LandingPage() {
  const session = await auth()
  if (session?.user) redirect('/dashboard')

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted px-4">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">
          AI Code Review
        </h1>
        <p className="text-xl text-muted-foreground">
          Security vulnerabilities and code smells caught automatically on every Pull Request.
          Powered by Claude.
        </p>
        <div className="flex gap-4 justify-center">
          <form action={async () => {
            'use server'
            await signIn('github', { redirectTo: '/dashboard' })
          }}>
            <Button type="submit" size="lg">
              Login with GitHub
            </Button>
          </form>
        </div>
        <p className="text-sm text-muted-foreground">
          Connects to your GitHub repositories via GitHub App integration.
        </p>
      </div>
    </main>
  )
}
```

---

### Task 7.5: Dashboard Page

- [ ] **Create `src/app/dashboard/page.tsx`**

```typescript
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { MetricsCards } from '@/components/metrics-cards'
import { PRReviewCard } from '@/components/pr-review-card'
import { Button } from '@/components/ui/button'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/')

  const [repos, reviews, criticalCount, avgScore] = await Promise.all([
    prisma.repository.count({
      where: { installation: { userId: session.user.id, active: true } },
    }),

    prisma.review.findMany({
      where: { pullRequest: { repository: { installation: { userId: session.user.id } } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        pullRequest: { include: { repository: true } },
        findings: { select: { severity: true } },
      },
    }),

    prisma.finding.count({
      where: {
        severity: 'CRITICAL',
        review: { pullRequest: { repository: { installation: { userId: session.user.id } } } },
      },
    }),

    prisma.review.aggregate({
      where: { status: 'COMPLETED', pullRequest: { repository: { installation: { userId: session.user.id } } } },
      _avg: { securityScore: true },
    }),
  ])

  const appInstallUrl = `https://github.com/apps/${process.env.GITHUB_APP_NAME ?? 'your-app'}/installations/new`

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, @{session.user.login}</p>
        </div>
        <a href={appInstallUrl} target="_blank" rel="noreferrer">
          <Button variant="outline">Install GitHub App</Button>
        </a>
      </div>

      <MetricsCards
        repoCount={repos}
        prCount={reviews.length}
        criticalCount={criticalCount}
        avgSecurityScore={avgScore._avg.securityScore ? Math.round(avgScore._avg.securityScore) : null}
      />

      {reviews.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <p className="text-lg mb-2">No reviews yet</p>
          <p>Open a Pull Request on a repository with the app installed to trigger your first AI review.</p>
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold mb-4">Recent Reviews</h2>
          {reviews.map(review => {
            const findings = review.findings
            return (
              <PRReviewCard
                key={review.id}
                reviewId={review.id}
                prNumber={review.pullRequest.number}
                prTitle={review.pullRequest.title}
                repoFullName={review.pullRequest.repository.fullName}
                authorLogin={review.pullRequest.authorLogin}
                status={review.status}
                securityScore={review.securityScore}
                qualityScore={review.qualityScore}
                criticalCount={findings.filter(f => f.severity === 'CRITICAL').length}
                highCount={findings.filter(f => f.severity === 'HIGH').length}
                mediumCount={findings.filter(f => f.severity === 'MEDIUM').length}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
```

---

### Task 7.6: Review Detail Page

- [ ] **Create `src/app/reviews/[reviewId]/page.tsx`**

```typescript
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { FindingCard } from '@/components/finding-card'
import { FindingsSummary } from '@/components/findings-summary'
import { ProcessingProgress } from '@/components/processing-progress'
import { ReviewStatusBadge } from '@/components/review-status-badge'
import { ScoreRing } from '@/components/score-ring'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface Finding {
  id: string; title: string; description: string; suggestion: string
  severity: string; category: string; filePath: string; lineStart: number; confidence: number
}

interface Review {
  id: string; status: string; processingStage: string | null
  securityScore: number | null; qualityScore: number | null
  findingsCount: number; startedAt: string | null; completedAt: string | null
  errorMessage: string | null
  findings: Finding[]
  pullRequest: {
    number: number; title: string; authorLogin: string
    headBranch: string; baseBranch: string
    repository: { fullName: string }
    githubPrUrl: string
  }
}

export default function ReviewDetailPage({ params }: { params: { reviewId: string } }) {
  const router = useRouter()
  const [review, setReview] = useState<Review | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchReview = useCallback(async () => {
    const res = await fetch(`/api/reviews/${params.reviewId}`)
    if (res.ok) {
      const data = await res.json()
      setReview(data)
      if (data.status === 'COMPLETED' || data.status === 'FAILED') setLoading(false)
    }
  }, [params.reviewId])

  useEffect(() => {
    fetchReview()
  }, [fetchReview])

  useEffect(() => {
    if (!review || review.status === 'COMPLETED' || review.status === 'FAILED') return
    const interval = setInterval(async () => {
      const res = await fetch(`/api/reviews/${params.reviewId}/status`)
      if (res.ok) {
        const status = await res.json()
        if (status.status === 'COMPLETED' || status.status === 'FAILED') {
          await fetchReview()
          clearInterval(interval)
        } else {
          setReview(prev => prev ? { ...prev, ...status } : prev)
        }
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [review?.status, params.reviewId, fetchReview])

  if (!review && loading) {
    return <div className="max-w-4xl mx-auto px-4 py-8 text-muted-foreground">Loading review...</div>
  }

  if (!review) {
    return <div className="max-w-4xl mx-auto px-4 py-8">Review not found.</div>
  }

  const { pullRequest: pr } = review
  const findings = review.findings ?? []
  const secFindings = findings.filter(f => f.category === 'SECURITY')
  const smellFindings = findings.filter(f => f.category === 'CODE_SMELL')

  const duration = review.startedAt && review.completedAt
    ? Math.round((new Date(review.completedAt).getTime() - new Date(review.startedAt).getTime()) / 1000)
    : null

  const prUrl = `https://github.com/${pr?.repository?.fullName}/pull/${pr?.number}`
  const repoUrl = `https://github.com/${pr?.repository?.fullName}`

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">{pr?.repository?.fullName} #{pr?.number}</p>
            <h1 className="text-xl font-bold truncate">{pr?.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              by @{pr?.authorLogin} · {pr?.baseBranch} ← {pr?.headBranch}
            </p>
          </div>
          <ReviewStatusBadge status={review.status as any} />
        </div>

        <div className="flex gap-3 mt-4">
          <a href={prUrl} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">View Pull Request ↗</Button>
          </a>
          <a href={repoUrl} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">View Repository ↗</Button>
          </a>
        </div>

        {duration != null && (
          <div className="flex gap-6 mt-4 text-xs text-muted-foreground">
            {review.startedAt && <span>Started: {new Date(review.startedAt).toLocaleTimeString()}</span>}
            {review.completedAt && <span>Completed: {new Date(review.completedAt).toLocaleTimeString()}</span>}
            <span>Duration: {duration}s</span>
          </div>
        )}
      </div>

      <Separator className="mb-6" />

      {/* Processing state */}
      {review.status === 'PROCESSING' && (
        <ProcessingProgress currentStage={review.processingStage} />
      )}

      {/* Failed state */}
      {review.status === 'FAILED' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-red-800">Review failed</p>
          {review.errorMessage && (
            <p className="text-xs text-red-600 mt-1">{review.errorMessage}</p>
          )}
        </div>
      )}

      {/* Scores */}
      {review.status === 'COMPLETED' && (
        <>
          <div className="flex gap-8 justify-center mb-6">
            <ScoreRing score={review.securityScore ?? 0} label="Security" />
            <ScoreRing score={review.qualityScore ?? 0} label="Code Quality" />
          </div>

          <div className="mb-6">
            <FindingsSummary
              critical={findings.filter(f => f.severity === 'CRITICAL').length}
              high={findings.filter(f => f.severity === 'HIGH').length}
              medium={findings.filter(f => f.severity === 'MEDIUM').length}
            />
          </div>

          {secFindings.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3">Security</h2>
              {secFindings.map(f => <FindingCard key={f.id} {...f} />)}
            </div>
          )}

          {smellFindings.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3">Code Smell</h2>
              {smellFindings.map(f => <FindingCard key={f.id} {...f} />)}
            </div>
          )}

          {findings.length === 0 && (
            <div className="text-center py-12 text-muted-foreground border rounded-lg">
              <p className="text-lg">No significant findings</p>
              <p className="text-sm mt-1">This PR looks clean!</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Add API route for full review data `src/app/api/reviews/[reviewId]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: { reviewId: string } }
): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const review = await prisma.review.findUnique({
    where: { id: params.reviewId },
    include: {
      findings: { where: { published: true }, orderBy: { severity: 'asc' } },
      pullRequest: { include: { repository: true } },
    },
  })

  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(review)
}
```

- [ ] **Create PR redirect page `src/app/repos/[owner]/[repo]/pulls/[number]/page.tsx`**

```typescript
import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export default async function PRPage({
  params,
}: {
  params: { owner: string; repo: string; number: string }
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/')

  const fullName = `${params.owner}/${params.repo}`
  const prNumber = parseInt(params.number, 10)

  const pr = await prisma.pullRequest.findFirst({
    where: { repository: { fullName }, number: prNumber },
    include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })

  if (!pr || pr.reviews.length === 0) notFound()

  redirect(`/reviews/${pr.reviews[0].id}`)
}
```

---

### Phase 7 Verification

```bash
npm run dev
```

Manual checklist:
- [ ] `/` shows landing page with "Login with GitHub" button
- [ ] Logging in redirects to `/dashboard`
- [ ] Dashboard shows metrics cards and "Install GitHub App" button
- [ ] After installing app, repos appear in dashboard on next visit
- [ ] Opening a PR on an installed repo triggers a webhook
- [ ] Worker processes the job and posts comments on GitHub
- [ ] `/reviews/[id]` shows processing progress then findings
- [ ] "View Pull Request" and "View Repository" links work

---

## Railway Deployment

### Service 1 — Web

- Root directory: `/`
- Build command: `npx prisma generate && npm run build`
- Start command: `npm run start`
- Environment variables: all from `.env.example`

### Service 2 — Worker

- Root directory: `/`
- Build command: `npx prisma generate`
- Start command: `npm run worker`
- Environment variables: same as Service 1 (minus `AUTH_*` if desired)

Both services share the same PostgreSQL and Redis add-ons configured in Railway.

Add `GITHUB_APP_NAME` env var (the slug of your GitHub App) for the dashboard install link.

---

## Self-Review Checklist

- [x] All phases produce independently testable deliverables
- [x] No TBDs or placeholder steps
- [x] Type names are consistent across all tasks (AIFinding, PullRequestDiff, AnalyzePRJobData, etc.)
- [x] Deduplication key is `filePath + lineStart + title` throughout
- [x] Confidence thresholds (0.85/0.70) used consistently in gate and test files
- [x] Status transitions guarded in processor; only PENDING→PROCESSING→COMPLETED/FAILED allowed
- [x] `jobId: reviewId` present in `enqueueReviewJob`
- [x] Startup recovery in `worker/index.ts`
- [x] GitHub publish failure saves findings and marks FAILED without losing analysis
- [x] `Finding.suggestion` non-nullable in schema and required in Zod schemas
- [x] All Claude responses validated with Zod before use
- [x] "View Pull Request" and "View Repository" GitHub links on review detail page
- [x] `processingStage` field drives ProcessingProgress component
- [x] `/repos/[owner]/[repo]/pulls/[number]` redirects to latest review
