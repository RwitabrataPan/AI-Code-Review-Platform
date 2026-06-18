# AI Code Review Platform — Product Specification

## 1. Overview

An enterprise-grade AI Code Review Platform that automatically reviews GitHub Pull Requests, posting inline security and code smell findings plus a structured summary comment. Reviews are triggered by a GitHub App webhook, processed asynchronously by a BullMQ worker, and powered by Claude.

### MVP Success Criteria

1. A user can log in with GitHub OAuth.
2. They can install the GitHub App on a repository.
3. When a PR is opened or pushed to, the platform automatically posts inline review comments and a summary comment on GitHub.
4. A dashboard shows PR history, scores, and findings.

### Target Users

Software companies, engineering teams, and startup CTOs who want fewer, higher-accuracy findings rather than exhaustive shallow scanning.

**Competitive reference:** CodeRabbit, SonarQube, Snyk.

---

## 2. MVP Scope

### In Scope

- GitHub OAuth login
- GitHub App installation flow
- Webhook receiver for `pull_request` events
- AI review: Security Analysis + Code Smell Detection (parallel)
- Inline review comments on specific diff lines
- Summary review comment (scores + grouped findings)
- Dashboard: repo list, PR history, metrics cards
- PR review detail page with findings and live processing progress
- Canonical review URL (`/reviews/[reviewId]`)

### Out of Scope (Post-MVP)

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

**Platform:** Railway — two services from one repository.

| Service | Type | Start Command |
|---|---|---|
| Web | Next.js App | `npm run start` |
| Worker | Node.js process (no HTTP server) | `npm run worker` |

Both services share the same PostgreSQL and Redis add-ons. No Turborepo. No monorepo tooling.

### Service Responsibilities

**Service 1 — Next.js Web App**
- GitHub OAuth login via NextAuth.js
- GitHub App installation callback
- Webhook receiver (`POST /api/webhooks/github`) — validates signature, enqueues job, returns 200 immediately
- Dashboard UI (Server Components + Prisma direct queries)
- REST status endpoint for client polling

**Service 2 — BullMQ Worker**
- Consumes `pr-analysis` queue from Redis
- Fetches PR diff from GitHub API
- Runs AI analysis pipeline
- Posts GitHub review (inline comments + summary)
- Updates Review record to COMPLETED or FAILED

**Shared code (imported by both services)**
- `src/lib/db.ts` — Prisma client singleton
- `src/lib/redis.ts` — Redis connection
- `src/lib/queue.ts` — queue definition and job types
- `src/lib/ai/` — provider interface and Claude implementation
- `src/types/` — shared TypeScript types
- `src/lib/logger.ts` — structured logging (pino)

### End-to-End Flow

```
GitHub user opens PR
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

### Prisma Schema

```prisma
model User {
  id            String         @id @default(cuid())
  githubId      Int            @unique
  login         String
  email         String?
  avatarUrl     String?
  accessToken   String         // encrypted at rest with AES-256-GCM
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
  processingStage String?         // "FETCHING_DIFF" | "SECURITY_ANALYSIS" | "GENERATING_SUMMARY" | "PUBLISHING"
  securityScore   Int?            // 0–100, null until COMPLETED
  qualityScore    Int?            // 0–100, null until COMPLETED
  findingsCount   Int             @default(0)
  githubReviewId  Int?
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
  confidence      Float           // 0.0–1.0
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
  event            String
  action           String?
  payload          Json          // raw payload retained for debugging and replay
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

### Key Data Decisions

- **`Finding.suggestion` is non-nullable** — the AI must always provide a concrete fix. Enforced at the data layer.
- **`Installation.active` soft-deletes on uninstall** — set to `false` rather than cascading deletes, preserving historical review data.
- **`PullRequest.lastReviewedSha`** — prevents re-reviewing the same commit when the webhook fires multiple times for the same push.
- **`Review.processingStage`** — powers the live progress UI. Not required for correctness; critical for demo experience.
- **`WebhookDelivery.payload`** — retained for debugging and future replay.
- **`Finding.published`** — distinguishes findings posted to GitHub from those saved-only due to confidence thresholds.

---

## 5. GitHub Integration

### Two GitHub Constructs

**GitHub OAuth App** — user authentication only.
- Scopes: `read:user`, `user:email`
- Handled by NextAuth.js GitHub provider
- Stores `githubId`, `login`, `avatarUrl`, encrypted `accessToken` on the User record

**GitHub App** — repository access, webhooks, and comment posting.
- Permissions: `pull_requests: write`, `contents: read`, `metadata: read`, `checks: read`
- Subscribed events: `pull_request`, `installation`, `installation_repositories`
- Generates short-lived installation tokens (1h TTL) for all repo API calls
- Never uses the user's OAuth token for repository operations

### Webhook Handler — `POST /api/webhooks/github`

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
   installation_repositories (removed) → Delete Repository records

   anything else → WebhookDelivery (IGNORED)

6. Return 200 in all cases — never 5xx a webhook
```

### Installation Token Flow (Worker)

At the start of each job:
1. Sign a GitHub App JWT with the App's private key (10-minute expiry)
2. `POST /app/installations/{id}/access_tokens` → short-lived token (1h TTL)
3. Use token for all GitHub API calls in this job
4. Token is not persisted

### Review Versioning

Each push to a PR creates a new `Review` record. Previous reviews are preserved. The PR detail page redirects to the latest review. `/reviews/[reviewId]` is the canonical URL for any specific review — this future-proofs review history browsing.

### Comment Publishing

All inline comments and the summary are posted atomically in a single GitHub API call:

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

If this call fails after analysis completes, findings are already saved to the DB and the Review is marked FAILED with `errorMessage`. Analysis work is never lost.

---

## 6. AI Provider Interface

### TypeScript Contract

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
  suggestion: string     // always present — non-nullable
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

- Model: `claude-sonnet-4-6`
- Temperature: `0` (deterministic)
- All responses validated with Zod before use — raw AI output is never accepted anywhere in the system.
- The worker imports only `getAIProvider()` — never `ClaudeProvider` or `@anthropic-ai/sdk` directly.

### Local Development Mode

Set `USE_MOCK_AI=true` to use `MockAIProvider`: a deterministic implementation with no Anthropic API calls. Detects SQL injection, hardcoded secrets, command injection, path traversal, long functions, magic numbers, TODO comments, and console.log statements via regex rules.

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
Deduplicate (filePath + lineStart + title — keep highest confidence)
Confidence gate:
  ≥ 0.85  → published to GitHub + saved to DB  (published = true)
  0.70–0.84 → saved to DB only                 (published = false)
  < 0.70  → discarded
generateSummary(publishableFindings, diff, context)
Zod validate summary
Post GitHub review (single API call)
```

### Large Diff Handling

PRs exceeding 8,000 patch lines are truncated before sending to the AI:
- Files prioritized by additions count descending
- A truncation note is included in the summary comment when this occurs

**Post-MVP:** Chunked analysis via `analyze-pr-chunk` queue — one child job per file group, parent aggregates results.

---

## 7. Job Queue and Worker Pipeline

### Queue Names

| Queue | Status |
|---|---|
| `pr-analysis` | Active (MVP) |
| `analyze-pr-chunk` | Reserved (chunked analysis, post-MVP) |
| `publish-review` | Reserved (decoupled publish, post-MVP) |

### Job Configuration

- `jobId` = `reviewId` — prevents duplicate enqueue for the same review
- Concurrency: 3 workers
- Max lock duration: 5 minutes (BullMQ v5 `lockDuration`)
- Attempts: 3 with exponential backoff from 5s
- Completed jobs retained: 24 hours
- Failed jobs retained: 7 days

### Startup Recovery

On worker boot, before accepting any jobs:

```
Find all Reviews where status = PROCESSING AND startedAt < (now - 15 min)
For each: mark FAILED, errorMessage = "Worker interrupted"
```

Prevents permanently stuck reviews from worker crashes.

### Full Processor Pipeline

```
1.  Guard: if headSha === PullRequest.lastReviewedSha → exit (no-op)
2.  Validate status = PENDING; transition PENDING → PROCESSING
    Set Review.startedAt, processingStage = "FETCHING_DIFF"
3.  Fetch GitHub installation token
4.  Fetch PR diff (GET /repos/{owner}/{repo}/pulls/{number}/files)
    Build PullRequestDiff; truncate if > 8,000 patch lines
5.  processingStage = "SECURITY_ANALYSIS"
    Run analyzeSecurity() and analyzeCodeSmells() in parallel
6.  Zod validate both responses (throw on schema mismatch → triggers BullMQ retry)
7.  Merge findings
8.  Deduplicate: key = filePath + lineStart + title → keep highest confidence on clash
9.  Apply confidence gate (≥ 0.85 published, 0.70–0.84 saved-only, < 0.70 discarded)
10. Save all findings ≥ 0.70 to DB (published flag set accordingly)
11. processingStage = "GENERATING_SUMMARY"
    Build ReviewContext; generateSummary(publishableFindings, diff, context)
    Zod validate summary
12. processingStage = "PUBLISHING"
    POST /repos/{owner}/{repo}/pulls/{number}/reviews (single call)
13. If publish fails:
    Findings already saved ✓  Summary already computed ✓
    Mark Review FAILED with errorMessage; do not re-throw (analysis preserved)
14. If publish succeeds:
    Transition PROCESSING → COMPLETED
    Set: securityScore, qualityScore, findingsCount, githubReviewId, completedAt
    Update: PullRequest.lastReviewedSha = headSha
```

### Status Transitions

Valid: `PENDING → PROCESSING → COMPLETED`
Valid: `PENDING → PROCESSING → FAILED`
All other transitions throw before any DB write.

### Error Handling

| Failure | Behaviour |
|---|---|
| GitHub token fetch fails | BullMQ retry (exponential backoff, 3 attempts) |
| Diff fetch fails | BullMQ retry |
| AI provider error | BullMQ retry |
| Zod validation fails | BullMQ retry |
| GitHub publish fails | Save findings + summary; mark FAILED with errorMessage |
| All retries exhausted | Review → FAILED; job preserved 7 days |
| headSha already reviewed | Exit immediately; no DB writes |

---

## 8. Frontend

### Routes

| Route | Description |
|---|---|
| `/` | Landing page — value prop + "Login with GitHub" CTA |
| `/dashboard` | Installed repos, recent PRs, metrics cards |
| `/repos/[owner]/[repo]/pulls/[number]` | Redirects to latest review for this PR |
| `/reviews/[reviewId]` | Canonical review detail page |
| `/api/auth/[...nextauth]` | NextAuth.js OAuth handler |
| `/api/github/callback` | GitHub App installation callback |
| `/api/webhooks/github` | Webhook receiver |
| `/api/reviews/[reviewId]` | Full review data (findings included) |
| `/api/reviews/[reviewId]/status` | Lightweight polling endpoint |

### Auth

NextAuth.js with GitHub OAuth provider. Session stored as signed JWT. Middleware protects all `/dashboard`, `/repos`, and `/reviews` routes.

### Data Fetching

- **Server Components** for all initial page renders — direct Prisma queries, no API round-trip.
- **Client polling** on `/reviews/[reviewId]` while `status === PROCESSING` — polls `/api/reviews/[reviewId]/status` every 5 seconds, calls `router.refresh()` on COMPLETED.
- No SWR, no React Query — intentional for MVP simplicity.

### Dashboard

**Metrics cards (top):** Repositories Reviewed, Pull Requests Reviewed, Critical Findings, Average Security Score. All derived from existing DB data.

**Repository list:** Recent PRs per repo with status badge, security score, quality score, critical finding count.

**Empty states:**
- No repos installed → "Install the GitHub App to get started"
- App installed, no PRs → "Open a Pull Request to trigger your first AI review"

### Review Detail Page (`/reviews/[reviewId]`)

- PR title, base←head branches, author login, GitHub links
- Timestamps: Started At, Completed At, Duration
- Live processing progress bar (backed by `Review.processingStage`) while status = PROCESSING
- Security Score and Code Quality Score as circular ring indicators (0–100)
- Findings summary: Critical / High / Medium counts
- Findings grouped by category (SECURITY then CODE_SMELL), each with severity badge, file path, line number, description, suggestion, confidence

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

---

## 9. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS + shadcn/ui |
| Database | PostgreSQL (Railway add-on) |
| ORM | Prisma 5 |
| Cache / Queue | Redis (Railway add-on) |
| Job Queue | BullMQ 5 |
| Auth | NextAuth.js v5 beta (GitHub OAuth) |
| AI (production) | Claude `claude-sonnet-4-6` via `@anthropic-ai/sdk` |
| AI (development) | `MockAIProvider` — deterministic, no API calls |
| Deployment | Railway (two services) |

---

## 10. Future Phases

- Performance Analysis and Architecture Analysis passes
- OpenAI + Gemini providers (interface already supports them)
- Chunked diff analysis (`analyze-pr-chunk` queue)
- Decoupled publish step (`publish-review` queue)
- Repository Intelligence (dependency graph, knowledge graph)
- Team analytics and org-level dashboard
- Billing, usage limits, and settings UI
