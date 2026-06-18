# AI Code Review Platform — MVP Design Spec

**Date:** 2026-06-18
**Status:** Approved
**Scope:** MVP — PR Review Loop (Option A)

---

## 1. Overview

An enterprise-grade AI Code Review Platform that automatically reviews GitHub Pull Requests, posting inline security and code smell findings plus a structured summary comment — triggered by a GitHub App webhook, processed asynchronously by a BullMQ worker, and powered by Claude.

### MVP Success Criteria

The MVP is complete when:
1. A user can log in with GitHub OAuth
2. They can install the GitHub App on a repository
3. When a PR is opened or pushed to, the platform automatically posts inline review comments and a summary comment on GitHub
4. A dashboard shows the PR history, scores, and findings

### Target Users

- Software companies
- Engineering teams
- Startup CTOs

### Competitive Reference

CodeRabbit, SonarQube, Snyk — but focused on delivering fewer, higher-accuracy findings rather than exhaustive shallow scanning.

---

## 2. MVP Scope

### In Scope

- GitHub OAuth login
- GitHub App installation flow
- Webhook receiver for `pull_request` events
- AI review: Security Analysis + Code Smell Detection
- Inline review comments on specific diff lines
- Summary review comment (scores + grouped findings)
- Dashboard: repo list, PR history, metrics cards
- PR review detail page with findings and processing progress
- Canonical review URL (`/reviews/[reviewId]`)

### Explicitly Out of Scope (Post-MVP)

- Performance Analysis
- Architecture Analysis
- OpenAI / Gemini providers
- Approval workflows, auto-merge, review requests
- Billing, usage limits, team management
- Org-level analytics
- Settings pages
- Chunked analysis for very large PRs (reserved queue: `analyze-pr-chunk`)
- Separate publish queue (reserved queue: `publish-review`)

---

## 3. Architecture

### Deployment

**Platform:** Railway (two services from one repository)
**Service 1:** Next.js Web App
**Service 2:** BullMQ Worker (Node.js process, no HTTP server)
**Shared:** PostgreSQL, Redis (both Railway-managed)

No Turborepo. No monorepo tooling. Two Railway services with different start commands pointing at the same repo.

### Service Responsibilities

**Service 1 — Next.js Web App**
- GitHub OAuth login (NextAuth.js)
- GitHub App installation callback
- Webhook receiver (`POST /api/webhooks/github`) — validates, enqueues, returns 200 immediately
- Dashboard UI (Server Components)
- REST status endpoint for client polling

**Service 2 — BullMQ Worker**
- Consumes `pr-analysis` queue from Redis
- Fetches PR diff from GitHub API
- Runs AI analysis pipeline
- Posts GitHub review (inline comments + summary)
- Updates Review record on completion or failure

**Shared components (imported by both services)**
- `src/lib/db.ts` — Prisma client singleton
- `src/lib/redis.ts` — Redis connection
- `src/lib/queue.ts` — queue definition + job types
- `src/lib/ai/` — provider interface + Claude implementation
- `src/types/` — shared TypeScript types
- `src/lib/logger.ts` — structured logging utility

### End-to-End Flow

```
GitHub User opens PR
        │
        ▼
GitHub sends webhook ──► POST /api/webhooks/github
                               │
                          Validate HMAC-SHA256
                          Create Review (PENDING)
                          Enqueue "analyze-pr" (jobId = reviewId)
                          Return 200 immediately
                               │
                               ▼
                        Redis / BullMQ Queue
                               │
                               ▼
                        Worker picks up job
                               │
                    ┌──────────┴──────────┐
                    │                     │
              analyzeSecurity()    analyzeCodeSmells()   ← parallel
                    │                     │
                    └──────────┬──────────┘
                               │
                         Zod validate both
                         Merge + deduplicate
                         Confidence gate
                         Save findings to DB
                               │
                    ┌──────────┴──────────┐
                    │                     │
             Post inline comments   Post summary comment
             (publishable findings)  (scores + grouped findings)
                    │                     │
                    └──────────┬──────────┘
                               │
                      Mark Review COMPLETED
```

---

## 4. Data Model

### Schema

```prisma
model User {
  id            String         @id @default(cuid())
  githubId      Int            @unique
  login         String
  email         String?
  avatarUrl     String?
  accessToken   String         // encrypted at rest
  installations Installation[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

model Installation {
  id              String       @id @default(cuid())
  githubInstallId Int          @unique
  accountLogin    String
  accountType     String       // "Organization" | "User"
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
  fullName       String        // "owner/repo"
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
  state           String      // "open" | "closed" | "merged"
  headSha         String
  headBranch      String
  baseBranch      String
  lastReviewedSha String?     // skip re-review if headSha matches
  repositoryId    String
  repository      Repository  @relation(fields: [repositoryId], references: [id])
  reviews         Review[]
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@unique([repositoryId, githubPrId])
}

model Review {
  id              String          @id @default(cuid())
  pullRequestId   String
  pullRequest     PullRequest     @relation(fields: [pullRequestId], references: [id])
  status          ReviewStatus    @default(PENDING)
  processingStage String?         // "FETCHING_DIFF" | "SECURITY_ANALYSIS" | "CODE_SMELL_ANALYSIS" | "GENERATING_SUMMARY" | "PUBLISHING"
  securityScore   Int?            // 0–100, null until COMPLETED
  qualityScore    Int?            // 0–100, null until COMPLETED
  findingsCount   Int             @default(0)
  githubReviewId  Int?            // GitHub review ID after posting
  findings        Finding[]
  errorMessage    String?
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}

enum ReviewStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

// Valid transitions: PENDING→PROCESSING→COMPLETED, PENDING→PROCESSING→FAILED
// All other transitions are rejected before DB write.

model Finding {
  id              String          @id @default(cuid())
  reviewId        String
  review          Review          @relation(fields: [reviewId], references: [id])
  category        FindingCategory
  severity        FindingSeverity
  title           String
  description     String
  suggestion      String          // concrete fix — non-nullable, always required
  filePath        String
  lineStart       Int
  lineEnd         Int?
  confidence      Float           // 0.0–1.0, AI-assigned
  published       Boolean         @default(false)  // true if posted to GitHub
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
  githubDeliveryId String        @unique  // X-GitHub-Delivery header
  event            String        // X-GitHub-Event header
  action           String?
  payload          Json          // raw payload — retained for debugging and future replay
  signature        String        // X-Hub-Signature-256
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

### Key Design Decisions

- `Finding.suggestion` is non-nullable — the AI must always provide a concrete fix. Enforced at the data layer.
- `Installation.active` is set to false on deletion events rather than cascading deletes — preserves historical review data.
- `PullRequest.lastReviewedSha` prevents re-reviewing the same commit when the webhook fires multiple times for the same push.
- `Review.processingStage` powers the live progress UI; not required for correctness.
- `WebhookDelivery.payload` is retained for debugging and future replay capability.
- `Finding.published` distinguishes findings posted to GitHub from those saved-only due to confidence thresholds.

---

## 5. GitHub Integration

### Two GitHub Constructs

**GitHub OAuth App** — user authentication only.
- Scopes: `read:user`, `user:email`
- Handled by NextAuth.js GitHub provider
- Stores `githubId`, `login`, `avatarUrl`, encrypted `accessToken` on the User record

**GitHub App** — repository access + webhooks + comment posting.
- Permissions: `pull_requests: write`, `contents: read`, `metadata: read`, `checks: read`
- Subscribed events: `pull_request`, `installation`, `installation_repositories`
- Generates short-lived installation tokens (1h TTL) for all repo API calls
- Never uses the user's OAuth token for repository operations

### Webhook Handler (`POST /api/webhooks/github`)

```
1. Read X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery
2. Verify HMAC-SHA256 signature (constant-time compare) → 401 if invalid
3. Parse payload
4. Write WebhookDelivery (RECEIVED)
5. Route by event:

   pull_request (opened | synchronize | reopened)
     → Skip if headSha === PullRequest.lastReviewedSha (mark IGNORED)
     → Upsert Repository
     → Upsert PullRequest
     → Create Review (PENDING)
     → Enqueue "analyze-pr" (jobId = reviewId)
     → Update WebhookDelivery (ENQUEUED, reviewId)

   installation (created)  → Create Installation (active: true)
   installation (deleted)  → Set Installation.active = false

   installation_repositories (added)   → Upsert Repositories
   installation_repositories (removed) → Remove Repository records

   anything else → WebhookDelivery (IGNORED)

6. Return 200 in all cases
```

### Installation Token Flow (Worker)

At the start of each job, the worker obtains a fresh installation token:
1. Sign a GitHub App JWT with the App's private key (10-minute expiry)
2. `POST /app/installations/{id}/access_tokens` → short-lived token (1h)
3. Use token for all GitHub API calls in this job
4. Token is not persisted

### Review Versioning

Each push to a PR creates a new `Review` record. Previous reviews are preserved. The PR detail page redirects to the latest review. `/reviews/[reviewId]` is the canonical URL for any specific review — this future-proofs review history browsing.

### Comment Publishing (Single API Call)

```
POST /repos/{owner}/{repo}/pulls/{number}/reviews
{
  "commit_id": "{headSha}",
  "event": "COMMENT",
  "body": "<summary markdown>",
  "comments": [
    { "path": "src/auth.ts", "line": 42, "body": "**[CRITICAL — Security]** ..." },
    ...
  ]
}
```

All inline comments and the summary are posted atomically in one GitHub notification.

If this API call fails after analysis completes: findings are already saved to DB, Review is marked FAILED with errorMessage. Analysis work is never lost.

---

## 6. AI Provider Interface

### Contract

```typescript
// src/lib/ai/types.ts

export interface DiffFile {
  path: string
  patch: string
  additions: number
  deletions: number
  language: string       // inferred from file extension
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
  suggestion: string     // always present
  filePath: string
  lineStart: number
  lineEnd?: number
  confidence: number     // 0.0–1.0
}

export interface ReviewSummary {
  securityScore: number
  qualityScore: number
  recommendedActions: string[]
}

// src/lib/ai/provider.ts
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

### Claude Implementation

Model: `claude-sonnet-4-6`
Temperature: `0` (deterministic)
Output: JSON, mandatory Zod validation on every response — no raw Claude output is accepted anywhere in the system.

```typescript
// src/lib/ai/providers/claude.ts
export class ClaudeProvider implements AIProvider { ... }

// src/lib/ai/index.ts
export function getAIProvider(): AIProvider {
  return new ClaudeProvider()
}
```

The worker and all other callers import only `getAIProvider()` — never `ClaudeProvider` or `@anthropic-ai/sdk` directly.

### Prompt Strategy

Each method sends one API call. System prompt instructs Claude to:
- Analyze only changed lines in the diff
- Return a JSON array matching the Zod schema
- Only report findings with high confidence
- Return `[]` if nothing qualifies — never speculate

### Pipeline

Security and code smell analyses run in parallel (independent, halves latency):

```
Fetch diff
    │
┌───┴───┐
│       │
analyzeSecurity()   analyzeCodeSmells()
│       │
└───┬───┘
    │
Zod validate both
Merge findings
Deduplicate (filePath + lineStart + title)
Confidence gate:
  ≥ 0.85 → published to GitHub
  0.70–0.84 → saved to DB only (visible in dashboard)
  < 0.70 → discarded
Save findings (published flag set accordingly)
generateSummary(publishableFindings, diff, context)
Zod validate summary
Post GitHub review
```

### Large Diff Handling (MVP)

PRs exceeding 8,000 patch lines are truncated before sending to Claude:
- Files prioritized by additions count descending
- A note is included in the summary comment when truncation occurs

**Future (post-MVP):** Chunked analysis — split diff into file-level chunks, one child job per chunk (`analyze-pr-chunk` queue), parent job aggregates results.

---

## 7. Job Queue and Worker Pipeline

### Reserved Queue Names

| Queue | Status |
|---|---|
| `pr-analysis` | Active (MVP) |
| `analyze-pr-chunk` | Reserved (chunked analysis, post-MVP) |
| `publish-review` | Reserved (decoupled publish step, post-MVP) |

### Queue Configuration

```typescript
export const PR_ANALYSIS_QUEUE = 'pr-analysis'

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
    jobId: reviewId,          // prevents duplicate enqueue for same review
    timeout: 300_000,         // 5 minute hard timeout → triggers retry flow
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail:    { age: 604_800 },
  },
})
```

### Worker Configuration

```typescript
const worker = new Worker<AnalyzePRJobData>(
  PR_ANALYSIS_QUEUE,
  processAnalyzePR,
  { connection: redis, concurrency: 3 }
)
```

### Startup Recovery

On worker boot, before processing any jobs:

```
Find all Reviews where status = PROCESSING AND startedAt < (now - 15 minutes)
For each: mark FAILED, errorMessage = "Worker interrupted"
```

Prevents permanently stuck reviews from worker crashes.

### Full Pipeline

```
1.  Guard: if headSha === PullRequest.lastReviewedSha → exit (no-op)
2.  Status transition: PENDING → PROCESSING (reject if invalid)
    Set Review.startedAt, processingStage = "FETCHING_DIFF"
3.  Fetch GitHub installation token
4.  Fetch PR diff (GET /repos/{owner}/{repo}/pulls/{number}/files)
    Build PullRequestDiff (truncate if > 8,000 patch lines)
5.  processingStage = "SECURITY_ANALYSIS" + "CODE_SMELL_ANALYSIS"
    Run analyzeSecurity() and analyzeCodeSmells() in parallel
6.  Zod validate both responses (throw on schema mismatch → retry)
7.  Merge findings
8.  Deduplicate: filePath + lineStart + title → keep highest confidence
9.  Confidence gate (≥ 0.85 published, 0.70–0.84 saved-only, < 0.70 discarded)
10. Save all findings ≥ 0.70 to DB (published flag set)
11. processingStage = "GENERATING_SUMMARY"
    Build ReviewContext
    generateSummary(publishableFindings, diff, context)
    Zod validate summary
12. processingStage = "PUBLISHING"
    POST /repos/{owner}/{repo}/pulls/{number}/reviews (single call)
13. If publish fails:
    - Findings already saved ✓
    - Summary already computed ✓
    - Mark Review FAILED with errorMessage
    - Do not lose analysis work
14. If publish succeeds:
    Status transition: PROCESSING → COMPLETED (reject if invalid)
    Set: securityScore, qualityScore, findingsCount, completedAt
    Update: PullRequest.lastReviewedSha = headSha
```

### Status Transition Rules

Valid: `PENDING → PROCESSING → COMPLETED`
Valid: `PENDING → PROCESSING → FAILED`
All other transitions are rejected before any DB write.

### Error Handling

| Failure | Behaviour |
|---|---|
| GitHub token fetch fails | BullMQ retry (exponential backoff, 3 attempts) |
| Diff fetch fails | BullMQ retry |
| Claude API error | BullMQ retry |
| Zod validation fails | BullMQ retry |
| GitHub publish fails | Save findings + summary; mark FAILED with errorMessage |
| All retries exhausted | Review → FAILED; job preserved 7 days |
| headSha already reviewed | Exit immediately; WebhookDelivery → IGNORED |

---

## 8. Dashboard and Frontend

### Routes

| Route | Description |
|---|---|
| `/` | Landing page — value prop + "Login with GitHub" CTA |
| `/dashboard` | Installed repos + recent PRs + metrics cards |
| `/repos/[owner]/[repo]/pulls/[number]` | PR page — redirects to latest review |
| `/reviews/[reviewId]` | Canonical review detail page |
| `/api/auth/[...nextauth]` | NextAuth.js OAuth handler |
| `/api/github/callback` | GitHub App installation callback |
| `/api/webhooks/github` | Webhook receiver |
| `/api/reviews/[reviewId]/status` | Polling endpoint for PROCESSING state |

### Auth

NextAuth.js with GitHub OAuth provider. Session stored as signed JWT. Middleware protects all `/dashboard`, `/repos`, and `/reviews` routes.

### Data Fetching

- **Server Components** for all initial page renders — direct Prisma queries, no API round-trip
- **Client polling** on `/reviews/[reviewId]` while `status === PROCESSING` — polls `/api/reviews/[reviewId]/status` every 5 seconds, calls `router.refresh()` on COMPLETED
- No SWR, no React Query — correct choice for MVP

### Dashboard Page

**Metrics cards (top):**
- Repositories Reviewed
- Pull Requests Reviewed
- Critical Findings
- Average Security Score

All derived from existing DB data — no additional backend complexity.

**Repository list:** Recent PRs per repo with status badge, security score, quality score, critical finding count.

**Empty state (no repos):** "Install the GitHub App to get started" → GitHub App install URL.
**Empty state (repo installed, no PRs):** "Open a Pull Request to trigger your first AI review."

### Review Detail Page (`/reviews/[reviewId]`)

**Header:** PR title, base←head branches, author login, "View Pull Request" link, "View Repository" link (GitHub links — recruiter-facing).

**Timestamps:** Started At, Completed At, Duration (demonstrates async processing visually).

**Processing progress (while PROCESSING):**
- Fetching Diff
- Running Security Analysis
- Running Code Smell Analysis
- Generating Summary
- Publishing Review

Backed by `Review.processingStage` — not required for correctness, critical for demo experience.

**Scores:** Security Score (0–100) and Code Quality Score (0–100) displayed as circular rings.

**Findings summary:** Critical / High / Medium counts.

**Findings grouped by category:** SECURITY then CODE_SMELL, each finding shows severity badge, title, file path + line number, description, suggestion, confidence percentage.

**"View on GitHub" actions:** View Pull Request, View Repository — direct GitHub links. Present on every review page.

### Component Structure

```
src/
  app/
    page.tsx
    dashboard/page.tsx
    repos/[owner]/[repo]/pulls/[number]/page.tsx
    reviews/[reviewId]/page.tsx
    api/...
  components/
    ui/                      ← shadcn/ui primitives
    review-status-badge.tsx
    finding-card.tsx
    score-ring.tsx
    findings-summary.tsx
    pr-review-card.tsx
    processing-progress.tsx
    metrics-cards.tsx
```

### Intentionally Excluded (Post-MVP)

Billing, team management, org analytics, settings, usage limits.

---

## 9. Tech Stack Summary

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Database | PostgreSQL (Railway) |
| ORM | Prisma |
| Cache / Queue | Redis (Railway) |
| Job Queue | BullMQ |
| Auth | NextAuth.js (GitHub OAuth) |
| AI | Claude (`claude-sonnet-4-6`) via Anthropic SDK |
| Deployment | Railway (two services) |

---

## 10. Future Phases (Not Designed)

- Performance Analysis
- Architecture Analysis
- OpenAI + Gemini providers (interface already supports them)
- Chunked diff analysis (`analyze-pr-chunk` queue)
- Decoupled publish step (`publish-review` queue)
- Repository Intelligence (dependency graph, import graph, knowledge graph)
- Team analytics and org-level dashboard
- Billing and usage limits
- Settings and configuration UI
