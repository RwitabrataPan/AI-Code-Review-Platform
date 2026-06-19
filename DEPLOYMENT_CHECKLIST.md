# Deployment Checklist — AI Code Review Platform

## Environment Variables

All variables are required unless marked optional.

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `AUTH_SECRET` | NextAuth secret (32+ chars) | `openssl rand -base64 32` |
| `AUTH_URL` | Public URL of the web service | `https://your-app.railway.app` |
| `AUTH_GITHUB_ID` | GitHub OAuth App client ID | `Iv1.abc123...` |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret | `secret...` |
| `GITHUB_APP_ID` | GitHub App numeric ID | `12345` |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App RSA private key (newlines as `\n`) | `-----BEGIN RSA PRIVATE KEY-----\n...` |
| `GITHUB_WEBHOOK_SECRET` | GitHub App webhook secret | `openssl rand -hex 20` |
| `GITHUB_APP_CLIENT_ID` | GitHub App OAuth client ID | `Iv1.xyz...` |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth client secret | `secret...` |
| `GITHUB_APP_NAME` | GitHub App slug (for install link) | `my-ai-reviewer` |
| `ANTHROPIC_API_KEY` | AI provider API key | `your-api-key-here` |
| `ENCRYPTION_KEY` | 32-byte hex key for token encryption | `openssl rand -hex 32` |
| `USE_MOCK_AI` | *(optional)* Set `true` to use MockAIProvider (no external AI API calls) | `true` |
| `LOG_LEVEL` | *(optional)* Pino log level | `info` |

---

## GitHub App Setup

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
2. Set **Webhook URL** to `https://<your-web-url>/api/webhooks/github`
3. Set **Webhook secret** — store as `GITHUB_WEBHOOK_SECRET`
4. Grant these **Repository permissions**:
   - Contents: Read
   - Pull requests: Read & Write
   - Issues: Read & Write (for comments)
5. Subscribe to **Events**:
   - Pull request
   - Installation
   - Installation repositories
6. After creation, generate a **Private key** — store as `GITHUB_APP_PRIVATE_KEY`
7. Note the **App ID** — store as `GITHUB_APP_ID`
8. Create an **OAuth credentials** under the App settings:
   - Store Client ID as `GITHUB_APP_CLIENT_ID`
   - Store Client Secret as `GITHUB_APP_CLIENT_SECRET`
9. Set **Callback URL** to `https://<your-web-url>/api/github/callback`

### GitHub OAuth App (for user login)

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Set **Authorization callback URL** to `https://<your-web-url>/api/auth/callback/github`
3. Store Client ID as `AUTH_GITHUB_ID` and Client Secret as `AUTH_GITHUB_SECRET`

---

## Railway Deployment

### Prerequisites
- Railway account at railway.app
- Railway CLI: `npm install -g @railway/cli` then `railway login`

### Service 1 — Web (Next.js)

```bash
# From project root
railway init                          # creates project
railway add --plugin postgresql       # provisions PostgreSQL
railway add --plugin redis            # provisions Redis

railway up                            # deploys from current directory
```

**Railway service settings:**
- **Build command:** `npx prisma generate && npm run build`
- **Start command:** `npm run start`
- **Environment variables:** set all from the table above
  - `DATABASE_URL` and `REDIS_URL` are auto-set by Railway add-ons

### Service 2 — Worker (BullMQ)

1. In Railway dashboard → New Service → GitHub Repo (same repo)
2. **Build command:** `npx prisma generate`
3. **Start command:** `npm run worker`
4. **Environment variables:** same as Service 1 (minus `AUTH_*` if desired)
5. Both services must share the **same** PostgreSQL and Redis add-ons

---

## Database Migration Steps

```bash
# First-time setup
npx prisma migrate dev --name init

# On Railway (run once after first deploy via Railway shell)
npx prisma migrate deploy

# Verify
npx prisma studio          # opens UI at localhost:5555
```

---

## Redis Setup

### Local development (no Docker)
```bash
# Windows — download Redis for Windows from https://github.com/microsoftarchive/redis
# Or use WSL:
wsl --install
wsl -e sudo apt install redis-server
wsl -e redis-server --daemonize yes

# macOS
brew install redis && brew services start redis

# Linux
sudo apt install redis-server && sudo systemctl start redis
```

### Production
Railway Redis add-on auto-configures `REDIS_URL`. No additional setup needed.

---

## Post-Deployment Verification

```bash
# 1. Health check — should return 200
curl https://<your-web-url>/api/auth/providers

# 2. Webhook — send a test ping from GitHub App settings → Advanced → Redeliver

# 3. Worker — check Railway logs for:
#    "Worker starting up"
#    "Worker ready — listening for jobs"

# 4. End-to-end — open a Pull Request on an installed repo and watch:
#    - WebhookDelivery row with status ENQUEUED appears in DB
#    - Review row transitions PENDING → PROCESSING → COMPLETED
#    - GitHub review comment appears on the PR
#    - /reviews/<id> page shows findings and scores
```

---

## Local Development

### Quick start (with MockAIProvider — no PostgreSQL/Redis needed for testing)

```bash
# Run pipeline validation (uses in-memory DB, no external services)
npm run validate

# Run unit tests
npm test

# TypeScript check
npx tsc --noEmit
```

### Full local stack

```bash
# 1. Start PostgreSQL and Redis (see Redis Setup above)

# 2. Copy and fill environment file
cp .env.example .env.local

# 3. Generate Prisma client and run migrations
npm run db:generate
npm run db:migrate

# 4. Start web server
npm run dev

# 5. Start worker (separate terminal)
npm run worker:dev

# 6. Expose local server for GitHub webhooks
npx ngrok http 3000
# Set ngrok URL as webhook URL in GitHub App settings
```

---

## Exact Commands Reference

| Task | Command |
|------|---------|
| Run locally (web) | `npm run dev` |
| Run locally (worker) | `npm run worker:dev` |
| Run tests | `npm test` |
| Type check | `npx tsc --noEmit` |
| E2E validation (no DB/Redis needed) | `npm run validate` |
| Build for production | `npm run build` |
| Start production web | `npm run start` |
| Start production worker | `npm run worker` |
| Generate Prisma client | `npm run db:generate` |
| Run migrations (dev) | `npm run db:migrate` |
| Run migrations (prod) | `npx prisma migrate deploy` |
| Open DB UI | `npx prisma studio` |
