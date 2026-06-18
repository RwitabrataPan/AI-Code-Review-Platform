# AI Code Review Platform — Implementation Plan

## Global Constraints

These rules apply across all phases and all code:

- Node.js ≥ 20.x; TypeScript strict mode throughout
- All path imports use `@/` alias mapped to `./src`
- All Claude responses validated with Zod — raw AI output is never accepted anywhere in the system
- Status transitions: `PENDING → PROCESSING → COMPLETED` or `PENDING → PROCESSING → FAILED` only; all others throw before any DB write
- Confidence thresholds: ≥ 0.85 published to GitHub; 0.70–0.84 saved to DB only; < 0.70 discarded
- Deduplication key: `filePath + lineStart + title` — keep highest confidence on clash
- `Finding.suggestion` is non-nullable — every finding must include a concrete fix
- BullMQ `jobId` equals `reviewId` — prevents duplicate enqueue for the same review
- Worker: concurrency 3, lock duration 5 min (BullMQ v5 `lockDuration`), 3 attempts, exponential backoff from 5s

---

## Phase 1: Project Foundation

**Objectives:** Bootstrapped Next.js 15 app, complete Prisma schema, core utilities (logger, crypto, db, redis), vitest passing.

**Outcome:** All 7 DB tables created, crypto roundtrip tests pass, TypeScript compiles with no errors.

### Files Created

```
package.json             ← scripts: worker, worker:dev, test, test:watch, db:generate, db:migrate, db:push
vitest.config.ts
.env.example
prisma/schema.prisma     ← full 7-model schema with all enums
src/lib/logger.ts        ← pino with pino-pretty in development
src/lib/crypto.ts        ← AES-256-GCM encrypt/decrypt using ENCRYPTION_KEY env var
src/lib/db.ts            ← Prisma client singleton (globalThis pattern)
src/lib/redis.ts         ← ioredis singleton; maxRetriesPerRequest: null (required by BullMQ)
src/lib/crypto.test.ts   ← roundtrip, unique ciphertext, tamper detection
```

### Key Technical Decisions

- `ENCRYPTION_KEY` is a 32-byte hex string (64 chars), generate with `openssl rand -hex 32`.
- `ioredis` singleton uses `maxRetriesPerRequest: null` — required by BullMQ v5; omitting this causes silent connection failures.
- Prisma client uses the `globalThis` singleton pattern to prevent multiple instances in Next.js hot-reload.
- `pino-pretty` is dev-only; production logs are JSON to stdout.

### Verification

```bash
npm test           # crypto tests: 3 passing
npx tsc --noEmit   # 0 errors
```

---

## Phase 2: AI Review Engine

**Objectives:** AI provider interface, Zod validation schemas, Claude implementation. All Claude responses validated before use. Tests pass with a mocked Anthropic client.

**Outcome:** `getAIProvider()` is the single import for AI — callers never touch `ClaudeProvider` or the SDK directly.

### Files Created

```
src/lib/ai/types.ts                 ← DiffFile, PullRequestDiff, ReviewContext, AIFinding, ReviewSummary
src/lib/ai/provider.ts              ← AIProvider interface
src/lib/ai/schemas.ts               ← findingsSchema (z.array), summarySchema — Zod validators
src/lib/ai/providers/claude.ts      ← ClaudeProvider: analyzeSecurity, analyzeCodeSmells, generateSummary
src/lib/ai/providers/mock.ts        ← MockAIProvider: deterministic regex rules, no API calls
src/lib/ai/index.ts                 ← getAIProvider() — returns MockAIProvider if USE_MOCK_AI=true
src/lib/ai/schemas.test.ts          ← valid/invalid finding and summary schema tests
src/lib/ai/providers/claude.test.ts ← mocked Anthropic SDK tests
```

### Key Technical Decisions

- Temperature `0` on all Claude calls — deterministic output required for consistent CI behavior.
- `extractJSON` handles three output formats: fenced code block, inline JSON array/object, raw JSON. Claude sometimes wraps responses in markdown.
- `MockAIProvider` enables full local development and CI without Anthropic API access. Set `USE_MOCK_AI=true` in `.env.local`.
- Zod schema rejects any finding missing `suggestion` — enforces the non-nullable constraint before it hits the DB layer.

### Verification

```bash
npm test           # all tests pass (crypto + schemas + claude provider)
npx tsc --noEmit   # 0 errors
```

---

## Phase 3: GitHub Integration Layer

**Objectives:** GitHub App JWT authentication, installation token exchange, webhook signature validation, PR diff fetcher, GitHub Reviews API publisher. No real GitHub credentials required for tests.

**Outcome:** All GitHub API interactions are encapsulated in `src/lib/github/`. Tests mock the SDK.

### Files Created

```
src/lib/github/app.ts       ← getInstallationToken(), getAppOctokit(), getInstallationOctokit()
src/lib/github/webhook.ts   ← validateWebhookSignature() — HMAC-SHA256, constant-time compare
src/lib/github/diff.ts      ← fetchPRDiff() — sorts files by additions, truncates at 8,000 patch lines
src/lib/github/review.ts    ← publishGitHubReview() — single API call, inline + summary comments
src/lib/github/types.ts     ← PullRequestWebhookPayload, InstallationWebhookPayload interfaces
src/lib/github/webhook.test.ts
src/lib/github/diff.test.ts
src/lib/github/review.test.ts
```

### Key Technical Decisions

- `GITHUB_APP_PRIVATE_KEY` env var uses literal `\n` sequences; `app.ts` replaces `\\n` → `\n` at runtime. This is the Railway/environment-variable-safe encoding for multi-line PEM keys.
- `validateWebhookSignature` uses `timingSafeEqual` — prevents timing side-channel attacks.
- `fetchPRDiff` sorts files by `additions` descending before truncation — ensures the highest-impact files are always analyzed when a PR is too large.
- `publishGitHubReview` accepts an optional `_octokit` parameter for dependency injection in tests — avoids ESM read-only export patching issues.
- All inline comments and the summary are posted in a single `pulls.createReview` call — one GitHub notification, atomic delivery.
- If GitHub publish fails after analysis is complete, findings are already in the DB. The caller catches the error and marks the Review FAILED without losing data.

### Language Detection

File extension → language string mapping covers: `ts/tsx → typescript`, `js/jsx → javascript`, `py → python`, `rb → ruby`, `go → go`, `java → java`, `cs → csharp`, `php → php`, `rs → rust`, `cpp → cpp`, `c → c`, `swift → swift`, `kt → kotlin`. Unknown extensions fall back to `unknown`.

### Verification

```bash
npm test           # all tests pass
npx tsc --noEmit   # 0 errors
```

---

## Phase 4: Job Queue and Worker Pipeline

**Objectives:** BullMQ queue definition, pipeline stages (dedup, confidence gate), full `processAnalyzePR` processor, worker entry point with startup recovery.

**Outcome:** Worker can process a job end-to-end given mocked dependencies. Stuck review recovery runs on every startup.

### Files Created

```
src/lib/queue.ts                             ← prAnalysisQueue, AnalyzePRJobData, enqueueReviewJob()
src/worker/pipeline/deduplicate.ts           ← deduplicateFindings()
src/worker/pipeline/confidence-gate.ts       ← applyConfidenceGate() — returns { publishable, savedOnly }
src/worker/processors/analyze-pr.ts          ← processAnalyzePR() — full pipeline orchestration
src/worker/index.ts                          ← Worker entry point, startup recovery, SIGTERM handler
src/worker/pipeline/deduplicate.test.ts
src/worker/pipeline/confidence-gate.test.ts
```

### Key Technical Decisions

- **BullMQ v5 connection:** Cannot share a top-level `ioredis` instance — BullMQ v5 bundles its own ioredis and the types conflict. Both `queue.ts` and `worker/index.ts` parse `REDIS_URL` into a plain `{ host, port, maxRetriesPerRequest: null }` options object.
- **BullMQ v5 removed per-job `timeout`:** Use `lockDuration: 300_000` on the Worker constructor instead. This enforces a 5-minute processing window.
- **Queue name type:** `Queue` is typed as `Queue<AnalyzePRJobData, void, string>` — the third generic prevents the queue name literal from causing type errors.
- **Startup recovery:** On boot, any Review stuck in PROCESSING for > 15 minutes is marked FAILED with `"Worker interrupted"`. This handles mid-job worker crashes without manual intervention.
- **GitHub publish failure isolation:** If the GitHub API call fails after analysis, findings are already saved. The processor catches only the publish error, marks the Review FAILED, and returns (does not re-throw). All other errors re-throw so BullMQ retries.

### Verification

```bash
npm test           # all tests pass
npx tsc --noEmit   # 0 errors
# With real Redis:
npm run worker:dev  # should log "Worker ready — listening for jobs"
```

---

## Phase 5: Webhook Handler

**Objectives:** `POST /api/webhooks/github` route. Validates HMAC signature, routes events, creates Review records, enqueues jobs. Returns 200 for all valid requests — never 5xx a webhook.

**Outcome:** End-to-end webhook → DB → queue flow operational.

### Files Created

```
src/app/api/webhooks/github/route.ts       ← POST handler, event router
src/app/api/webhooks/github/route.test.ts  ← invalid signature, unknown event, pull_request opened
```

### Event Routing

| Event | Action | Behaviour |
|---|---|---|
| `pull_request` | `opened`, `synchronize`, `reopened` | Upsert repo + PR, create Review, enqueue job |
| `pull_request` | anything else | Mark delivery IGNORED |
| `pull_request` | headSha matches lastReviewedSha | Mark delivery IGNORED, skip |
| `installation` | `deleted` | Set Installation.active = false |
| `installation_repositories` | `added` | Upsert repositories |
| `installation_repositories` | `removed` | Delete repository records |
| Any other event | — | Mark delivery IGNORED |

### Key Technical Decisions

- The route always returns `200 { ok: true }` for valid signatures — GitHub retries on non-2xx, which would create duplicate reviews.
- `WebhookDelivery` is written before routing so failures during event processing are always recorded.
- `X-GitHub-Delivery` header value is used as the idempotency key on `WebhookDelivery`.
- Pull request events on inactive installations are silently ignored (installation may have been uninstalled between webhook send and receipt).

### Verification

```bash
npm test
# Manual: ngrok http 3000, set URL in GitHub App settings, open a PR
# Check DB: WebhookDelivery (ENQUEUED), Review (PENDING)
```

---

## Phase 6: Authentication and Installation

**Objectives:** GitHub OAuth login via NextAuth.js v5, GitHub App installation callback, route middleware.

**Outcome:** Users can log in, install the app, and be redirected to the dashboard. Protected routes redirect unauthenticated users to `/`.

### Files Created

```
src/lib/auth.ts                              ← NextAuth config: GitHub provider, JWT strategy, upsert user
src/types/next-auth.d.ts                     ← Session type augmentation: user.id, user.login
src/app/api/auth/[...nextauth]/route.ts      ← re-exports handlers from auth.ts
src/app/api/github/callback/route.ts         ← installation callback: upsert Installation, sync repos
src/middleware.ts                            ← protects /dashboard, /repos, /reviews routes
```

### Key Technical Decisions

- **NextAuth v5 beta** uses `auth()` as a server-side function rather than `getServerSession()`. Import `{ auth }` from `@/lib/auth`.
- **`profile.image` type issue:** NextAuth types `profile.image` as `{} | undefined`. Cast via `(profile as any).avatar_url` to access the GitHub-specific field.
- **JWT strategy** — no session table needed. The JWT stores `userId` (internal DB id) and `login` (GitHub username).
- **Installation callback** (`/api/github/callback`) upserts the Installation record and immediately syncs accessible repositories using a fresh installation token. Errors are caught and logged — the user is always redirected to `/dashboard`.
- **Middleware matcher** excludes `/api/webhooks/github` (must be publicly accessible for GitHub to call it) and all `/api/auth/*` routes.
- `User.accessToken` is stored encrypted with AES-256-GCM. The GitHub App uses installation tokens for repo operations — the user OAuth token is only stored for future user-scoped features.

### Verification

```bash
npm test
npx tsc --noEmit
# With real credentials: log in, install app, verify Installation + Repository rows in DB
```

---

## Phase 7: Dashboard and Frontend

**Objectives:** Landing page, dashboard, PR detail redirect, review detail page with live progress, status API endpoints, all UI components.

**Outcome:** Full application UI operational. Review detail page polls for status updates while processing.

### Files Created

```
src/app/page.tsx                                    ← Landing page with GitHub login CTA
src/app/dashboard/page.tsx                          ← Server component: metrics + repo list
src/app/repos/[owner]/[repo]/pulls/[number]/page.tsx ← Server component: redirect to latest review
src/app/reviews/[reviewId]/page.tsx                 ← Client component: live review detail with polling
src/app/api/reviews/[reviewId]/route.ts             ← GET: full review with findings
src/app/api/reviews/[reviewId]/status/route.ts      ← GET: lightweight status-only endpoint
src/components/review-status-badge.tsx
src/components/finding-card.tsx
src/components/score-ring.tsx
src/components/findings-summary.tsx
src/components/pr-review-card.tsx
src/components/processing-progress.tsx
src/components/metrics-cards.tsx
```

### Key Technical Decisions

- **Next.js 15 async params:** All route handlers and page components must type `params` as `Promise<{...}>`. Route handlers and server pages `await params`. Client pages unwrap with `React.use(params)`.
- **Polling strategy:** The review detail page polls `/api/reviews/[reviewId]/status` (lightweight) every 5 seconds while `status === PROCESSING`. On COMPLETED or FAILED, it fetches the full review from `/api/reviews/[reviewId]` and stops polling. No SWR or React Query dependency.
- **Server Components for all initial renders** — dashboard and landing page use direct Prisma queries. No client-side data fetching on first load.
- **`/repos/[owner]/[repo]/pulls/[number]`** is a pure server-side redirect to the latest review — it never renders UI. This keeps the canonical review URL stable across re-reviews.
- **shadcn/ui initialization** requires running `npx shadcn@latest init --defaults --yes` and then adding components individually. Components used: `button`, `badge`, `card`, `separator`, `skeleton`, `avatar`.
- `ScoreRing` uses SVG stroke-dasharray/dashoffset for the circular score visualization — no chart library dependency.

### API Route Auth

Both `/api/reviews/[reviewId]` and `/api/reviews/[reviewId]/status` call `auth()` and return 401 if no session. The webhook route is explicitly excluded from auth.

### Verification

```bash
npm run build      # must complete with 0 type errors
npm test           # all 9 test files, 33 tests passing
npx tsc --noEmit   # 0 errors
npm run validate   # E2E pipeline: in-memory DB, MockAIProvider, full findings cycle
```

---

## E2E Pipeline Validation

`scripts/validate-pipeline.ts` runs the full analysis pipeline without PostgreSQL, Redis, or Anthropic:

- Uses `pg-mem` (in-memory PostgreSQL) with the full Prisma schema applied manually
- Seeds: User → Installation → Repository → PullRequest → Review (PENDING)
- Runs MockAIProvider against a sample diff containing SQL injection, hardcoded secrets, and TODO comments
- Applies deduplication and confidence gate
- Stores findings and generates summary
- Calls `publishGitHubReview` with an injected mock Octokit
- Prints evidence: finding counts, scores, GitHub payload structure, DB state

```bash
npm run validate
```

Expected output: 6 publishable findings, 2 saved-only, security/quality scores, GitHub review payload logged.

---

## Commands Reference

| Task | Command |
|---|---|
| Install dependencies | `npm install` |
| Generate Prisma client | `npm run db:generate` |
| Run dev migrations | `npm run db:migrate` |
| Run production migrations | `npx prisma migrate deploy` |
| Open DB browser | `npx prisma studio` |
| Start web (dev) | `npm run dev` |
| Start worker (dev) | `npm run worker:dev` |
| Run tests | `npm test` |
| Watch tests | `npm run test:watch` |
| Type check | `npx tsc --noEmit` |
| E2E validate (no services) | `npm run validate` |
| Build for production | `npm run build` |
| Start web (production) | `npm run start` |
| Start worker (production) | `npm run worker` |
