# Audit for SEO Under-Performing Locations

A [Zeus](https://github.com/owner/zeus) app deployed at [audit-for-seo-under-performing-locations.owner.sh](https://audit-for-seo-under-performing-locations.owner.sh).

## What is Zeus?

Zeus is an internal platform for building and deploying apps on shared infrastructure. This app was scaffolded by the Zeus Generator with everything pre-configured: a Cloudflare Worker runtime, D1 database, R2 storage, authentication, and CI/CD.

## Tech Stack

- **Runtime**: [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- **Framework**: [TanStack Start](https://tanstack.com/start) (React + SSR)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite)
- **Storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Auth**: Zeus App User Auth (JWT via JWKS)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [pnpm](https://pnpm.io/) v9+ (`corepack enable` to activate)

### Local Development

```bash
pnpm install
npx wrangler d1 migrations apply DB --local
pnpm dev
```

The dev server runs at [http://localhost:3000](http://localhost:3000).

You must run `npx wrangler d1 migrations apply DB --local` before first start (and after adding new migrations) to set up the local D1 database. Data is stored in `.wrangler/state/`.

### Type Checking

```bash
pnpm typecheck
```

## Authentication

This app uses the **Zeus App User Auth** system. Users are authenticated via JWT tokens issued by the Zeus Auth Portal.

- Users without a valid session are redirected to the Zeus Auth Portal to log in
- After login, a `__zeus_session` cookie is set and verified on subsequent requests
- Auth logic lives in `src/lib/auth.server.ts` — all server functions must call `requireAuth()` before accessing data
- **Local dev** (`ENVIRONMENT=development`): auth is bypassed and `getAuthUser()`/`requireAuth()` return a synthetic local-dev user, so you never have to log in while developing. Deployed apps always run with `ENVIRONMENT=production` and enforce real auth.

See [AGENTS.md](./AGENTS.md) for detailed auth rules.

## Database Migrations

Migrations live in `migrations/` and run automatically on deploy. To add a migration:

1. Create `migrations/NNNN_description.sql` (use the next sequence number)
2. Write your SQL statements
3. Commit and push — CI applies migrations before deploying

To apply migrations to the remote database manually:

```bash
npx wrangler d1 migrations apply DB --env production --remote
```

## Deployment

Deployments happen automatically on push to `main` via GitHub Actions. The workflow:

1. Installs dependencies (`pnpm install --frozen-lockfile`)
2. Applies D1 migrations to the production database
3. Builds and deploys the worker to Cloudflare

The `CLOUDFLARE_API_TOKEN` secret is scoped to the `deploy` GitHub environment (restricted to the `main` branch) and is already configured. Zeus also manages the `OPENROUTER_API_KEY` Worker secret for server-side LLM calls; generate local development keys from the Zeus run page.

## Scheduled Jobs

This app is deployed through Zeus Workers for Platforms. Zeus run-page schedules do **not** invoke a native Cloudflare Worker `scheduled(controller, env, ctx)` handler.

When you add a schedule in Zeus, the central `zeus-cron` worker sends an HTTP request to this app through the dispatch namespace. The default contract is:

```txt
POST /__zeus/cron
Authorization: Bearer <Zeus-signed JWT>
Content-Type: application/json
x-zeus-job: <jobName>
x-zeus-run-id: <runId>
```

```json
{
  "job": "jobName",
  "runId": "run_...",
  "scheduledFor": "ISO timestamp"
}
```

The generated app does not include this route by default. Add a handler for the configured path before enabling a schedule, verify the JWT against Zeus JWKS with `iss=zeus-cron` and `aud=ZEUS_APP_ID`, enqueue the job, and return a 2xx response once accepted.

## Project Structure

```
├── src/
│   ├── lib/
│   │   └── auth.server.ts      # Auth helpers (getAuthUser, requireAuth)
│   ├── routes/
│   │   ├── __root.tsx           # Root layout
│   │   ├── index.tsx            # Main page component
│   │   ├── -index.api.ts        # Server functions (API layer)
│   │   └── auth/callback.tsx    # Auth callback handler
│   └── styles/global.css        # Tailwind config + theme tokens
├── migrations/                  # D1 SQL migrations
├── scripts/                     # Build scripts
├── wrangler.json                # Cloudflare Worker config
├── .oxfmtrc.json                # Formatter config (oxfmt)
└── .github/workflows/deploy.yml # CI/CD pipeline
```

## Formatting & Linting

This project uses **oxfmt** (not Prettier) and **oxlint** (not ESLint):

```bash
pnpm format         # Format code
pnpm format:check   # Verify formatting (runs in CI)
pnpm lint           # Lint code (runs in CI)
pnpm lint:fix       # Auto-fix lint issues
```

Style: no semicolons, single quotes, 2-space indent.
