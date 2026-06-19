# AI Code Review Platform

Automated GitHub Pull Request review platform that detects security vulnerabilities and code quality issues, posts inline review comments, and provides a centralized dashboard for engineering teams.

Built using Next.js, PostgreSQL, Redis, BullMQ, Prisma, GitHub Apps, and a scalable worker architecture.

---

## Overview

Code reviews are essential for maintaining software quality, security, and maintainability. However, manual reviews are time-consuming and often inconsistent.

AI Code Review Platform automates the first-pass review process by analyzing Pull Requests, identifying potential issues, and publishing actionable feedback directly on GitHub.

The platform follows a production-style SaaS architecture with webhook-driven workflows, asynchronous background processing, GitHub App integration, and a scalable review pipeline.

---

## Key Features

### Automated Pull Request Reviews

* GitHub App Integration
* Automatic reviews on PR open, reopen, and update
* Webhook-driven processing pipeline
* Background job execution using BullMQ

### Security Analysis

Detects issues such as:

* SQL Injection
* Command Injection
* Hardcoded Secrets
* Path Traversal
* Unsafe Input Handling
* Authentication & Authorization Risks

### Code Quality Analysis

Detects issues such as:

* Long Functions
* Excessive Complexity
* TODO/FIXME Technical Debt
* Debug Statements
* Magic Numbers
* Maintainability Issues

### GitHub Review Publishing

* Inline comments attached to affected lines
* Consolidated review summaries
* Severity-based findings
* Actionable remediation suggestions

### Review Dashboard

* Repository overview
* Pull Request history
* Security scores
* Code quality scores
* Review status tracking
* Findings breakdown by severity

---

## Architecture

```text
GitHub Pull Request
        │
        ▼
GitHub Webhook
        │
        ▼
Next.js Web Application
        │
        ▼
BullMQ Queue (Redis)
        │
        ▼
Worker Service
        │
 ┌──────┴──────┐
 │             │
Security   Code Quality
Analysis    Analysis
 │             │
 └──────┬──────┘
        │
        ▼
Review Generation
        │
        ▼
GitHub Review API
        │
        ▼
Inline Comments + Summary
```

---

## Technology Stack

### Frontend

* Next.js 15
* React
* TypeScript
* Tailwind CSS
* shadcn/ui

### Backend

* Next.js API Routes
* BullMQ
* Redis
* Prisma ORM
* PostgreSQL

### Authentication

* NextAuth.js
* GitHub OAuth

### Integrations

* GitHub App
* GitHub Webhooks
* GitHub Reviews API

### Infrastructure

* Railway
* PostgreSQL
* Redis

---

## Project Structure

```text
src/
├── app/
│   ├── api/
│   ├── dashboard/
│   ├── repos/
│   └── reviews/
│
├── components/
│
├── lib/
│   ├── ai/
│   ├── github/
│   ├── db.ts
│   ├── redis.ts
│   └── queue.ts
│
├── worker/
│   ├── pipeline/
│   └── processors/
│
└── types/

prisma/
docs/
```

---

## Environment Variables

Create a `.env.local` file:

```env
DATABASE_URL=

REDIS_URL=

NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=

ANTHROPIC_API_KEY=

USE_MOCK_AI=false

ENCRYPTION_KEY=
```

Generate an encryption key:

```bash
openssl rand -hex 32
```

---

## Installation

### Clone Repository

```bash
git clone https://github.com/RwitabrataPan/AI-Code-Review-Platform.git

cd AI-Code-Review-Platform
```

### Install Dependencies

```bash
npm install
```

### Generate Prisma Client

```bash
npm run db:generate
```

### Run Database Migrations

```bash
npm run db:migrate
```

---

## Running Locally

### Start Development Server

```bash
npm run dev
```

### Start Worker

```bash
npm run worker:dev
```

Application URL:

```text
http://localhost:3000
```

---

## Mock AI Mode

The platform includes a deterministic Mock AI Provider for local development and testing.

Enable it by setting:

```env
USE_MOCK_AI=true
```

This allows the complete review pipeline to run without external AI services while still generating realistic findings.

Supported detections include:

* SQL Injection
* Hardcoded Secrets
* Command Injection
* TODO/FIXME Comments
* Long Functions
* Magic Numbers
* Debug Statements

This mode is useful for:

* Local development
* Demonstrations
* CI pipelines
* Testing without API costs

---

## Testing

Run all tests:

```bash
npm test
```

Run TypeScript checks:

```bash
npx tsc --noEmit
```

Build for production:

```bash
npm run build
```

---

## Pipeline Validation

Run the complete review pipeline locally:

```bash
npm run validate
```

This executes:

* Review creation
* Mock AI analysis
* Deduplication
* Confidence filtering
* Summary generation
* GitHub review payload generation

without requiring PostgreSQL, Redis, GitHub credentials, or external AI services.

---

## Pull Request Review Workflow

1. User signs in with GitHub
2. User installs the GitHub App
3. Developer opens or updates a Pull Request
4. GitHub sends a webhook event
5. Review job is added to Redis queue
6. Worker processes the Pull Request
7. Security and quality analyses run
8. Findings are generated
9. Review comments are published to GitHub
10. Results appear in the dashboard

---

## Current MVP Scope

### Included

* GitHub Authentication
* GitHub App Installation
* Pull Request Analysis
* Security Analysis
* Code Quality Analysis
* Dashboard
* Review History
* Queue Processing
* Worker Architecture

### Planned

* Performance Analysis
* Architecture Analysis
* Multi-Provider AI Support
* Team Analytics
* Repository Intelligence
* Usage Analytics
* Billing & Subscription Management

---

## Example Findings

### Security Finding

```text
CRITICAL — SQL Injection

File: src/db.ts:42

User input is concatenated directly into a SQL query.

Recommendation:
Use parameterized queries or an ORM abstraction.
```

### Code Quality Finding

```text
HIGH — Long Function

File: src/auth.ts:108

Function exceeds recommended complexity threshold.

Recommendation:
Extract logic into smaller, reusable functions.
```

---

## Future Roadmap

* Performance Analysis Engine
* Architecture Analysis Engine
* Multi-Provider Support
* Repository Intelligence Layer
* Team Analytics Dashboard
* Usage Reporting
* Enterprise Controls
* Organization-Level Insights

---

### Dashboard

```text
docs/screenshots/dashboard.png
```

### Pull Request Review

```text
docs/screenshots/review.png
```

---

## License

MIT License
