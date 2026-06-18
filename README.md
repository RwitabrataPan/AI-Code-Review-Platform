# AI Code Review Platform

An automated code review platform that integrates with GitHub Pull Requests to deliver inline security findings and code quality analysis, posted directly as GitHub review comments. Built for engineering teams who need actionable, high-confidence feedback on every PR — without manual triage.

---

## Overview

When a developer opens or pushes to a Pull Request, the platform:

1. Receives a GitHub webhook and enqueues a background review job
2. Fetches the PR diff and runs parallel security and code quality analysis
3. Filters findings through a confidence gate before posting
4. Posts inline comments on specific diff lines and a structured summary comment directly to the GitHub PR
5. Records all findings, scores, and review history in the dashboard

**Problem it solves:** Code review bottlenecks slow delivery and security vulnerabilities slip through manual review. This platform provides consistent, automated analysis on every PR — catching SQL injection, hardcoded secrets, command injection, long functions, and other high-signal issues before they reach production.

**Target users:** Engineering teams at software companies and startups who want automated code review integrated into their existing GitHub workflow.

---

## Features

| Feature | Description |
|---|---|
| **GitHub OAuth Login** | Secure sign-in via GitHub OAuth. Sessions stored as signed JWTs — no session table required |
| **GitHub App Integration** | Install on any repo; the App handles webhooks, diff access, and comment posting using short-lived installation tokens |
| **Parallel PR Analysis** | Security and code smell passes run concurrently, halving analysis latency |
| **Security Vulnerability Detection** | Detects SQL injection, hardcoded secrets, command injection, and path traversal |
| **Code Smell Detection** | Detects long functions (>40 lines), magic numbers, TODO comments, and console logging in production code |
| **Confidence Gate** | Findings ≥ 0.85 confidence are published to GitHub; 0.70–0.84 are saved to the dashboard only; below 0.70 are discarded |
| **Inline GitHub Review Comments** | Each finding is posted as an inline comment on the exact diff line, with severity, description, and a concrete fix suggestion |
| **Summary Review Comment** | A structured summary with security score, quality score, finding counts, and recommended actions is posted atomically with inline comments |
| **Review Dashboard** | Metrics cards, per-repo PR history, scores, and finding details — all server-rendered via direct Prisma queries |
| **Live Processing Progress** | The review detail page polls for status updates while a review is in progress, showing the current pipeline stage |
| **Background Job Processing** | BullMQ workers consume from Redis; 3 concurrent workers, 3-attempt exponential backoff, automatic stuck-review recovery on startup |
| **Duplicate Prevention** | `jobId` = `reviewId` prevents double-enqueue; `lastReviewedSha` prevents re-analyzing the same commit |
| **Multi-Tenant Architecture** | Installation and repository records are scoped per GitHub account; the data model supports multiple organizations |
| **Mock AI Development Mode** | Deterministic rules-based analysis with no external API calls — run the full review pipeline locally without any paid services |

---

## Architecture

```mermaid
graph TD
    GH[GitHub Pull Request]
    WH[POST /api/webhooks/github]
    DB[(PostgreSQL)]
    Q[(Redis / BullMQ)]
    W[BullMQ Worker]
    AI[AI Provider]
    GHR[GitHub Review Comments]
    DASH[Dashboard UI]

    GH -->|webhook| WH
    WH -->|validate HMAC| WH
    WH -->|create Review PENDING| DB
    WH -->|enqueue job| Q
    WH -->|return 200 immediately| GH

    Q -->|dequeue| W
    W -->|fetch installation token| GH
    W -->|fetch PR diff| GH
    W -->|analyzeSecurity + analyzeCodeSmells in parallel| AI
    AI -->|findings array + Zod validated| W
    W -->|deduplicate + confidence gate| W
    W -->|save findings| DB
    W -->|generateSummary| AI
    W -->|POST pulls reviews - single API call| GHR
    W -->|mark COMPLETED| DB

    DB -->|server-rendered queries| DASH
```

### Service Architecture

The platform runs as two Railway services from a single repository, sharing PostgreSQL and Redis:

**Service 1 — Next.js Web App**
Handles user authentication, GitHub App installation, webhook ingestion, the dashboard UI, and REST status polling endpoints. The webhook handler validates the HMAC-SHA256 signature, records a `WebhookDelivery`, enqueues a job, and returns `200` immediately — it never blocks on analysis.

**Service 2 — BullMQ Worker**
A long-running Node.js process (`src/worker/index.ts`) with no HTTP server. On startup it recovers any reviews stuck in `PROCESSING` for more than 15 minutes (worker crash recovery). It then listens on the `pr-analysis` queue with a concurrency of 3 and a 5-minute lock duration per job.

**PostgreSQL**
Primary datastore. Seven models: `User`, `Installation`, `Repository`, `PullRequest`, `Review`, `Finding`, `WebhookDelivery`. Managed by Prisma 5. The `Finding.suggestion` field is non-nullable — every finding must carry a concrete fix before it reaches the database.

**Redis**
Job queue backend for BullMQ. Completed jobs are retained for 24 hours; failed jobs for 7 days.

**AI Provider Layer**
A single `AIProvider` interface (`src/lib/ai/provider.ts`) with two implementations: `ClaudeProvider` (production) and `MockAIProvider` (local development). All callers import only `getAIProvider()` — never the concrete class or SDK directly. Every AI response is validated with Zod before use.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 15 |
| Language | TypeScript (strict) | 5 |
| Styling | Tailwind CSS + shadcn/ui | 3 / latest |
| Database | PostgreSQL | 14+ |
| ORM | Prisma | 5 |
| Queue | BullMQ + Redis | 5 |
| Auth | NextAuth.js (beta) | 5 |
| GitHub API | @octokit/rest + @octokit/auth-app | 20 / 7 |
| Validation | Zod | 3 |
| Logging | pino + pino-pretty | 9 |
| Testing | Vitest | 1 |
| Runtime | Node.js | ≥ 20 |

---

## Prerequisites

Verify each before proceeding:

```bash
# Node.js 20 or higher required
node --version
# Expected: v20.x.x or higher

# npm (bundled with Node.js)
npm --version

# PostgreSQL
psql --version
# Expected: psql (PostgreSQL) 14.x or higher

# Redis
redis-cli --version
# Expected: Redis cli 6.x or higher

# Git
git --version
```

**macOS — install PostgreSQL and Redis with Homebrew:**
```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

**Windows — use WSL2:**
```bash
wsl --install
# Then inside WSL:
sudo apt update && sudo apt install -y postgresql redis-server
sudo service postgresql start
sudo service redis-server start
```

**Linux:**
```bash
sudo apt update && sudo apt install -y postgresql redis-server
sudo systemctl start postgresql
sudo systemctl start redis-server
```

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-org/ai-code-review.git
cd ai-code-review
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in all values. See [Environment Variables](#environment-variables) for the complete reference.

### 4. Set up the database

```bash
# Create the database (run once)
createdb ai_code_review

# Run migrations and generate the Prisma client
npm run db:migrate
```

### 5. Start the development server

```bash
# Terminal 1 — web server
npm run dev

# Terminal 2 — background worker
npm run worker:dev
```

The web app is available at `http://localhost:3000`.

---

## Environment Variables

Create `.env.local` from the template below. Every variable is required unless marked optional.

```bash
# ─── Database ─────────────────────────────────────────────────────────────────
# PostgreSQL connection string
# Local: postgresql://localhost:5432/ai_code_review
# Railway: automatically provided by the PostgreSQL add-on
DATABASE_URL="postgresql://localhost:5432/ai_code_review"

# ─── Redis ────────────────────────────────────────────────────────────────────
# Redis connection string
# Local: redis://localhost:6379
# Railway: automatically provided by the Redis add-on
REDIS_URL="redis://localhost:6379"

# ─── NextAuth ─────────────────────────────────────────────────────────────────
# Secret used to sign session JWTs. Generate with:
#   openssl rand -base64 32
AUTH_SECRET="your-32-char-secret-here"

# Public URL of the web service (no trailing slash)
# Local: http://localhost:3000
# Production: https://your-app.railway.app
AUTH_URL="http://localhost:3000"

# ─── GitHub OAuth App (user login) ────────────────────────────────────────────
# From: GitHub → Settings → Developer settings → OAuth Apps → your app
# Callback URL must be: <AUTH_URL>/api/auth/callback/github
AUTH_GITHUB_ID="your-oauth-app-client-id"
AUTH_GITHUB_SECRET="your-oauth-app-client-secret"

# ─── GitHub App (webhook + repo access + review posting) ──────────────────────
# From: GitHub → Settings → Developer settings → GitHub Apps → your app

# The numeric App ID shown on the app settings page
GITHUB_APP_ID="123456"

# RSA private key generated from the app settings page
# Newlines must be encoded as literal \n for environment variable compatibility
# Generate and encode: cat your-private-key.pem | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}'
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"

# Webhook secret set when creating the GitHub App (used for HMAC-SHA256 signature validation)
# Generate with: openssl rand -hex 20
GITHUB_WEBHOOK_SECRET="your-webhook-secret"

# OAuth credentials under the GitHub App (used for the installation callback)
# From: GitHub App settings → OAuth credentials section
GITHUB_APP_CLIENT_ID="Iv1.your-app-client-id"
GITHUB_APP_CLIENT_SECRET="your-app-client-secret"

# GitHub App slug — used to construct the installation URL in the dashboard
# This is the name you gave the app, lowercased and hyphenated
GITHUB_APP_NAME="your-app-name"

# ─── AI Provider ──────────────────────────────────────────────────────────────
# Anthropic API key — required for production AI analysis
# Get from: https://console.anthropic.com
ANTHROPIC_API_KEY="sk-ant-..."

# ─── Token Encryption ─────────────────────────────────────────────────────────
# 32-byte hex key used to encrypt GitHub OAuth access tokens at rest (AES-256-GCM)
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY="your-64-char-hex-string"

# ─── Optional ─────────────────────────────────────────────────────────────────
# Set to "true" to use the deterministic MockAIProvider — no API key required
# Recommended for local development and CI
USE_MOCK_AI="false"

# Pino log level: trace | debug | info | warn | error
# Defaults to "info"
LOG_LEVEL="info"
```

---

## GitHub OAuth App Setup

The OAuth App handles user login (`/api/auth/callback/github`).

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in the form:
   - **Application name:** `AI Code Review (local)` (or any name)
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`
3. Click **Register application**
4. Copy **Client ID** → `AUTH_GITHUB_ID`
5. Click **Generate a new client secret** → `AUTH_GITHUB_SECRET`

> For production, repeat with your Railway URL instead of `localhost:3000`.

---

## GitHub App Setup

The GitHub App handles webhook delivery, repository access, and posting review comments.

### Create the App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
2. Fill in:
   - **GitHub App name:** Choose a unique name (becomes your `GITHUB_APP_NAME` slug)
   - **Homepage URL:** `http://localhost:3000`
   - **Webhook URL:** Your publicly accessible URL + `/api/webhooks/github`
     - For local dev, use [ngrok](https://ngrok.com): `ngrok http 3000` → copy the HTTPS URL
   - **Webhook secret:** Generate with `openssl rand -hex 20` → save as `GITHUB_WEBHOOK_SECRET`

### Permissions

Under **Repository permissions**, set:

| Permission | Access |
|---|---|
| Contents | Read |
| Metadata | Read (mandatory) |
| Pull requests | Read and write |

### Events

Under **Subscribe to events**, check:

- [x] Pull request
- [x] Installation
- [x] Installation repositories (under **Account** permissions section)

### After creation

1. Note the **App ID** at the top of the settings page → `GITHUB_APP_ID`
2. Scroll to **Private keys** → **Generate a private key** → download the `.pem` file
3. Encode the key for the environment variable:
   ```bash
   cat your-private-key.pem | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}'
   ```
   Paste the output as the value of `GITHUB_APP_PRIVATE_KEY`

### OAuth credentials

Still on the App settings page, scroll to **OAuth credentials**:
- Copy **Client ID** → `GITHUB_APP_CLIENT_ID`
- Click **Generate a new client secret** → `GITHUB_APP_CLIENT_SECRET`
- Set **Callback URL** to `http://localhost:3000/api/github/callback`

### Install the App

To authorize the App on a repository, visit:
```
https://github.com/apps/YOUR_APP_NAME/installations/new
```

Or click **Install App** from the App settings page and select the repositories to enable.

---

## Database Setup

```bash
# Create the database
createdb ai_code_review

# Run all Prisma migrations (creates all 7 tables)
npm run db:migrate

# Verify: open the database browser
npx prisma studio
# → Opens at http://localhost:5555
# → Should show: User, Installation, Repository, PullRequest, Review, Finding, WebhookDelivery
```

**Reset the database** (destructive — development only):
```bash
npx prisma migrate reset
```

---

## Redis Setup

**macOS:**
```bash
brew install redis
brew services start redis
redis-cli ping   # Expected: PONG
```

**Linux / WSL:**
```bash
sudo apt install redis-server
sudo service redis-server start
redis-cli ping   # Expected: PONG
```

**Verify connection:**
```bash
redis-cli -u "$REDIS_URL" ping
```

---

## Running Locally

### Development mode (with hot reload)

```bash
# Terminal 1 — web server (Next.js dev server, hot reload)
npm run dev

# Terminal 2 — worker (tsx watch mode, restarts on file change)
npm run worker:dev
```

### Production build

```bash
npm run build     # compile Next.js app
npm run start     # start production web server
npm run worker    # start production worker (separate terminal)
```

### Expose webhooks for local development

GitHub needs a publicly accessible URL to deliver webhooks. Use [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok.io`) and set it as the Webhook URL in your GitHub App settings. Each `ngrok` session generates a new URL — update the App settings each time.

---

## Mock AI Development Mode

Run the complete review pipeline locally without any external API services.

### How it works

`MockAIProvider` (`src/lib/ai/providers/mock.ts`) implements the full `AIProvider` interface using deterministic regex rules applied to the PR diff. No network calls are made.

**Detection rules:**

| Finding | Rule |
|---|---|
| SQL Injection | `query(` with string concatenation, or template literals in SELECT statements |
| Hardcoded Secret | Assignment of `password`, `secret`, `api_key`, `token` to a string literal ≥ 6 chars |
| Command Injection | `exec`/`spawn`/`execSync` with a template literal argument |
| Path Traversal | `readFile` or `path.join` using `req.params`, `req.query`, or `req.body` |
| Long Function | Function body spanning >40 added lines (brace-counting heuristic) |
| Magic Number | Numeric literal ≥ 3 digits in an assignment, not in a comment |
| TODO Comment | Lines starting with `// TODO`, `// FIXME`, `// HACK`, `// XXX` |
| Console Logging | `console.log/warn/error/debug` in non-test files |

**Confidence levels** — findings are subject to the same confidence gate as production:
- CRITICAL findings (SQL injection, command injection): 0.92–0.95 → **published to GitHub**
- HIGH findings (hardcoded secrets, path traversal): 0.88–0.90 → **published to GitHub**
- MEDIUM findings (long functions): 0.85 → **published to GitHub**
- LOW / INFO findings (console.log, TODO, magic numbers): 0.72–0.80 → **saved to dashboard only**

### Enable Mock AI

```bash
# In .env.local
USE_MOCK_AI=true
```

### End-to-end validation (no services required)

This script runs the full pipeline using an in-memory PostgreSQL database (`pg-mem`) and a mock Octokit instance — no PostgreSQL, Redis, or API keys required:

```bash
npm run validate
```

**Expected output:**
```
✓ Review pipeline completed
  Security findings: 6 (publishable)
  Code smell findings: 2 (saved-only)
  Security score: 0
  Quality score: 100
  GitHub review payload: 6 inline comments
```

### Test workflow with a real repository

1. Set `USE_MOCK_AI=true` in `.env.local`
2. Start the dev server and worker
3. Expose localhost with ngrok
4. Open a Pull Request containing any of the patterns above (e.g., `const password = "hunter2"`)
5. Watch the worker logs — the review will complete in under a second
6. Visit the PR on GitHub — inline comments and a summary comment will appear

---

## Testing

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file change)
npm run test:watch

# TypeScript type checking
npx tsc --noEmit

# End-to-end pipeline validation (no external services)
npm run validate
```

### Test coverage

| Test file | What it covers |
|---|---|
| `src/lib/crypto.test.ts` | AES-256-GCM roundtrip, unique ciphertexts, tamper detection |
| `src/lib/ai/schemas.test.ts` | Zod schema validation for findings and summary |
| `src/lib/ai/providers/claude.test.ts` | Claude provider with mocked Anthropic SDK |
| `src/lib/github/webhook.test.ts` | HMAC-SHA256 signature validation |
| `src/lib/github/diff.test.ts` | PR diff fetching and truncation logic |
| `src/lib/github/review.test.ts` | GitHub review publishing and comment formatting |
| `src/worker/pipeline/deduplicate.test.ts` | Finding deduplication by `filePath:lineStart:title` key |
| `src/worker/pipeline/confidence-gate.test.ts` | Confidence threshold bucketing |
| `src/app/api/webhooks/github/route.test.ts` | Webhook handler: invalid signature, event routing, job enqueue |

**Current status:** 9 test files, 33 tests, all passing.

---

## Troubleshooting

### Redis connection failure

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

Redis is not running. Start it:
```bash
# macOS
brew services start redis

# Linux / WSL
sudo service redis-server start

# Verify
redis-cli ping   # Expected: PONG
```

### PostgreSQL connection failure

```
Error: P1001: Can't reach database server at localhost:5432
```

Check the database is running and `DATABASE_URL` is correct:
```bash
# macOS
brew services start postgresql@16

# Linux / WSL
sudo service postgresql start

# Verify
psql "$DATABASE_URL" -c "SELECT 1"
```

### Prisma migration errors

```
Error: Migration failed to apply
```

Reset and re-apply:
```bash
npx prisma migrate reset    # drops and recreates all tables (dev only)
npm run db:migrate          # applies all migrations
npm run db:generate         # regenerates the Prisma client
```

If the Prisma client is out of sync after a schema change:
```bash
npm run db:generate
```

### GitHub OAuth — redirect URI mismatch

```
Error: redirect_uri_mismatch
```

The **Authorization callback URL** in your GitHub OAuth App settings must exactly match `AUTH_URL` + `/api/auth/callback/github`. Check for trailing slashes, `http` vs `https`, and port numbers.

### GitHub App — webhook signature failures

```
Response: 401 {"error":"Invalid signature"}
```

Causes:
- `GITHUB_WEBHOOK_SECRET` does not match the secret set in the GitHub App settings
- The request body was modified in transit (e.g., by a proxy that re-encodes JSON)

Verify the secret matches exactly, including any trailing newlines.

### Worker fails to start

```
Error: REDIS_URL is not set
```

The worker reads `REDIS_URL` at startup. Ensure your shell has the environment loaded:
```bash
# If using .env.local, export variables manually or use a tool like dotenv-cli
export $(cat .env.local | grep -v '#' | xargs)
npm run worker:dev
```

Or use `tsx` with dotenv loaded:
```bash
node --env-file=.env.local node_modules/.bin/tsx src/worker/index.ts
```

### Worker stuck reviews not recovering

Reviews stuck in `PROCESSING` are automatically marked `FAILED` on worker startup if they have been processing for more than 15 minutes. If reviews are not recovering, check that the worker process started successfully and inspect the startup logs for the recovery message.

---

## Deployment

### Railway (recommended)

Railway runs both services from the same repository using different start commands.

#### 1. Install the Railway CLI

```bash
npm install -g @railway/cli
railway login
```

#### 2. Create project and provision services

```bash
# From the repository root
railway init

# Add managed PostgreSQL and Redis
railway add --plugin postgresql
railway add --plugin redis
```

`DATABASE_URL` and `REDIS_URL` are automatically injected by Railway.

#### 3. Deploy Service 1 — Web

In the Railway dashboard:
- **Source:** your GitHub repository
- **Build command:** `npx prisma generate && npm run build`
- **Start command:** `npm run start`
- **Environment variables:** add all values from the [Environment Variables](#environment-variables) section

#### 4. Deploy Service 2 — Worker

In the Railway dashboard, create a second service from the same repository:
- **Build command:** `npx prisma generate`
- **Start command:** `npm run worker`
- **Environment variables:** same as the web service (share the same PostgreSQL and Redis add-ons)

#### 5. Run database migrations

After the first deploy, open a Railway shell on the web service and run:

```bash
npx prisma migrate deploy
```

This applies all pending migrations to the production database. Only needs to be run once per schema change.

#### 6. Update GitHub App settings

Set the Webhook URL and OAuth callback URL in the GitHub App settings to your Railway production URL:
- **Webhook URL:** `https://your-app.railway.app/api/webhooks/github`
- **OAuth callback URL:** `https://your-app.railway.app/api/github/callback`

Also update the OAuth App callback URL:
- `https://your-app.railway.app/api/auth/callback/github`

#### 7. Verify deployment

```bash
# Check auth endpoints are reachable
curl https://your-app.railway.app/api/auth/providers
# Expected: JSON object with github provider

# Verify worker is running
# Railway dashboard → Worker service → Logs
# Expected: "Worker starting up" then "Worker ready — listening for jobs"

# End-to-end test
# 1. Open a PR on a repo with the app installed
# 2. Check Railway web service logs for "Webhook received"
# 3. Check worker logs for "Review completed"
# 4. Check GitHub PR for inline comments and summary
```

---

## Repository Structure

```
.
├── docs/
│   ├── PROJECT_SPEC.md         # Product specification and architecture decisions
│   └── IMPLEMENTATION_PLAN.md  # Phase-by-phase implementation reference
├── prisma/
│   ├── schema.prisma           # Database schema (7 models)
│   └── migrations/             # Prisma migration history
├── scripts/
│   └── validate-pipeline.ts    # E2E validation using in-memory DB
├── src/
│   ├── app/                    # Next.js App Router pages and API routes
│   │   ├── page.tsx            # Landing page
│   │   ├── dashboard/          # Review dashboard
│   │   ├── reviews/[reviewId]/ # Review detail page (client polling)
│   │   ├── repos/[owner]/...   # PR redirect → latest review
│   │   └── api/
│   │       ├── auth/           # NextAuth.js OAuth handler
│   │       ├── github/         # App installation callback
│   │       ├── reviews/        # Review GET + status polling endpoints
│   │       └── webhooks/       # GitHub webhook receiver
│   ├── components/             # Shared React components
│   │   ├── ui/                 # shadcn/ui primitives (button, badge, card…)
│   │   ├── finding-card.tsx    # Individual finding display
│   │   ├── score-ring.tsx      # SVG circular score indicator
│   │   ├── processing-progress.tsx  # Live pipeline stage display
│   │   └── ...
│   ├── lib/
│   │   ├── ai/                 # AI provider interface and implementations
│   │   │   ├── provider.ts     # AIProvider interface contract
│   │   │   ├── schemas.ts      # Zod validation schemas for AI responses
│   │   │   ├── types.ts        # Shared AI types (AIFinding, ReviewSummary…)
│   │   │   └── providers/
│   │   │       ├── claude.ts   # Production provider
│   │   │       └── mock.ts     # Development provider (no API calls)
│   │   ├── github/             # GitHub API client modules
│   │   │   ├── app.ts          # App JWT + installation token exchange
│   │   │   ├── diff.ts         # PR diff fetcher with truncation
│   │   │   ├── review.ts       # Review publisher (inline comments + summary)
│   │   │   └── webhook.ts      # HMAC-SHA256 signature validation
│   │   ├── auth.ts             # NextAuth.js configuration
│   │   ├── crypto.ts           # AES-256-GCM token encryption
│   │   ├── db.ts               # Prisma client singleton
│   │   ├── logger.ts           # Structured pino logger
│   │   ├── queue.ts            # BullMQ queue definition and job types
│   │   └── redis.ts            # ioredis singleton
│   ├── worker/
│   │   ├── index.ts            # Worker entry point; startup recovery; SIGTERM handler
│   │   ├── pipeline/
│   │   │   ├── deduplicate.ts  # Finding deduplication by filePath:line:title
│   │   │   └── confidence-gate.ts  # Publish / save-only / discard bucketing
│   │   └── processors/
│   │       └── analyze-pr.ts   # Full job processor orchestrating the pipeline
│   └── types/
│       └── next-auth.d.ts      # Session type augmentation
├── DEPLOYMENT_CHECKLIST.md     # Detailed deployment and ops reference
├── .env.example                # Environment variable template
└── package.json
```

---

## Roadmap

| Feature | Description |
|---|---|
| **Additional AI Providers** | Provider interface is ready for OpenAI and Gemini implementations without changes to the worker pipeline |
| **Architecture Analysis** | Dependency graph traversal; detect circular dependencies, import violations, and layering issues |
| **Performance Analysis** | Detect algorithmic complexity issues, N+1 query patterns, and unbounded loops |
| **Chunked Review Processing** | `analyze-pr-chunk` queue reserved — splits large PRs into per-file child jobs, aggregated by a parent job |
| **Decoupled Publish Step** | `publish-review` queue reserved — separates analysis from GitHub publishing for independent retry |
| **Repository Intelligence** | Build and cache cross-PR import graphs and dependency maps for context-aware review |
| **Team Analytics** | Org-level dashboard with trend analysis, finding resolution rates, and team score history |
| **Billing and Usage Limits** | Per-installation usage metering, plan enforcement, and billing integration |

---

## License

See [LICENSE](./LICENSE).
