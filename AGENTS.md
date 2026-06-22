# Audit for SEO Under-Performing Locations

## Overview

This app is part of the **Zeus platform** — an internal platform for building, deploying, and managing apps on shared infrastructure. It was scaffolded by the Zeus Generator and runs as a Cloudflare Worker using TanStack Start (React).

- **Production URL**: https://audit-for-seo-under-performing-locations.owner.sh
- **Zeus run page**: https://zeus.owner.sh/runs/949475a5-a6ff-4ed2-b15b-8a73a9183142
- **Runtime**: Cloudflare Workers
- **Framework**: TanStack Start (React + SSR)
- **Package manager**: pnpm (do NOT use npm or yarn)
- **Formatting**: oxfmt (no semicolons, single quotes, 2-space indent) — do NOT install Prettier, ESLint, or Biome
- **Linting**: oxlint

## Managing this app — READ CAREFULLY

The user does **NOT** have authentication for the `wrangler` CLI and does **NOT** have access to the Cloudflare dashboard. **Never tell the user to log in to Cloudflare, run `wrangler login`, or open the Cloudflare dashboard.**

All operational management of this app happens on the **Zeus run page**:

**https://zeus.owner.sh/runs/949475a5-a6ff-4ed2-b15b-8a73a9183142**

The run page is the single source of truth for managing this app. Direct the user there for:

| Task                                         | Where                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Secrets (API keys, tokens, etc.)             | Zeus run page → Secrets section                                                |
| Snowflake connection                         | Zeus run page → Integrations → Snowflake, then follow the Zeus Snowflake guide |
| Scheduled jobs (HTTP dispatch + run history) | Zeus run page -> Schedules section                                             |
| Logs (live tail + cron event logs)           | Zeus run page → Observability section                                          |
| Stats / request analytics                    | Zeus run page                                                                  |
| Database queries / SQL console               | Zeus run page → Database Console                                               |
| LLM keys (OpenRouter)                        | Zeus run page → LLM Keys                                                       |
| Access control (who can use the app)         | Zeus run page → Access Management                                              |
| GitHub repo collaborators                    | Zeus run page → Collaborators                                                  |
| Transfer app ownership                       | Zeus run page → Transfer Ownership                                             |
| Publish to the gallery                       | Zeus run page → Publish                                                        |
| Non-secret env vars                          | Edit `vars` in `wrangler.json`, commit, push (auto-deploys)                    |
| Deploys                                      | Push to `main` — GitHub Actions deploys automatically                          |
| D1 schema changes                            | Add a file in `migrations/` — applied automatically before deploy              |

### Things you must NEVER suggest

- ❌ `wrangler login` / `wrangler whoami`
- ❌ `wrangler secret put` / `wrangler secret bulk`
- ❌ `wrangler deploy` (use git push instead)
- ❌ `wrangler tail` (use the run page logs)
- ❌ `wrangler d1 execute` (use the run page database console)
- ❌ Editing `triggers.crons` in `wrangler.json` (use the run page)
- ❌ Opening the Cloudflare dashboard for any reason
- ❌ Custom domains — not supported on this platform; the app is only reachable at `https://audit-for-seo-under-performing-locations.owner.sh`

## Scheduling — READ CAREFULLY

This is a Zeus Workers-for-Platforms app. Native Cloudflare Worker cron triggers are not available for dispatch-namespace scripts, so Zeus run-page schedules do **not** call a Worker `scheduled(controller, env, ctx)` handler.

Zeus schedules are HTTP dispatches. The central `zeus-cron` worker ticks every minute, claims due schedules, and sends:

```txt
POST /__zeus/cron
Authorization: Bearer <Zeus-signed JWT>
Content-Type: application/json
x-zeus-job: <jobName>
x-zeus-run-id: <runId>
```

Body:

```json
{
  "job": "jobName",
  "runId": "run_...",
  "scheduledFor": "ISO timestamp"
}
```

The JWT uses `iss=zeus-cron`, `aud=ZEUS_APP_ID`, `sub=<jobName>`, `jti=<runId>`, and a short expiration. Verify it against Zeus JWKS before accepting work.

The generated app does not include `/__zeus/cron` by default. If a user wants scheduled work, add a `POST` handler at the configured path, verify the JWT, enqueue the job, and return a 2xx response after the job is accepted. Non-2xx responses are recorded as errors by Zeus.

## Auth System — READ CAREFULLY

This app uses the **Zeus App User Auth** system. Auth is **already wired up** and must be preserved.

### How it works

1. Users visit the app → the app checks for a valid `__zeus_session` JWT cookie via `requireAuth()`
2. If no valid session, the user is redirected to the **Zeus Auth Portal** to log in
3. After login, the portal redirects back to `/auth/callback` with a token that gets set as an HttpOnly cookie
4. JWTs are verified against the Zeus backend's JWKS endpoint using ES256
5. **Local dev only** (`ENVIRONMENT=development`): `getAuthUser()`/`requireAuth()` short-circuit to a synthetic local-dev user so you don't have to log in. This is gated solely on the server-side `ENVIRONMENT` var binding (deploys always set `production`), so it can never bypass auth on a deployed app. Keep auth checks in place exactly as-is — the bypass is handled inside the platform helpers, not by skipping `requireAuth()`.

### Key auth files

- `src/lib/auth.server.ts` — `getAuthUser()` and `requireAuth()` helpers
- `src/routes/auth/callback.tsx` — handles the auth redirect flow

### Rules for backend/server code

- **Every server function that reads or writes data MUST call `requireAuth()` or `getAuthUser()`** before doing anything else
- Use the dynamic import pattern already established:
  ```ts
  const { requireAuth } = await import('../lib/auth.server')
  await requireAuth()
  ```
- **Never remove or bypass auth checks** — all server functions are API endpoints accessible over the network
- **Do not modify `auth.server.ts` or `auth/callback.tsx`** unless explicitly asked — these are part of the platform auth contract
- The `__zeus_session` cookie name, JWKS URLs, and issuer (`zeus-backend`) are shared across the platform — do not change them

## Tech Stack Details

| Layer     | Technology                            |
| --------- | ------------------------------------- |
| Runtime   | Cloudflare Workers                    |
| Framework | TanStack Start (React)                |
| Routing   | TanStack Router (file-based)          |
| Styling   | Tailwind CSS v4                       |
| Database  | Cloudflare D1 (SQLite, bound as `DB`) |
| Storage   | Cloudflare R2 (bound as `STORAGE`)    |
| Auth      | Zeus JWT (ES256 via JWKS)             |

### Cloudflare bindings (available in server code)

Access bindings via:

```ts
const mod = await import('cloudflare:workers')
const env = mod.env as unknown as Env
```

- `env.DB` — D1 database
- `env.STORAGE` — R2 bucket
- `env.OPENROUTER_API_KEY` — app-scoped OpenRouter key for server-side LLM calls
- `env.SNOWFLAKE_*` — Snowflake connection secrets after Snowflake is connected from the Zeus run page
- `env.ENVIRONMENT` — `"development"` or `"production"`

### Snowflake integration

Zeus can attach the shared Snowflake credentials to this app as `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PRIVATE_KEY`, `SNOWFLAKE_PUBLIC_KEY_FP`, `SNOWFLAKE_WAREHOUSE`, and `SNOWFLAKE_ROLE` Worker secrets. When adding Snowflake features, send the user to the Zeus run page → Integrations → Snowflake if those secrets are not connected yet.

Follow the Zeus guide: https://github.com/owner/zeus/blob/main/docs/SNOWFLAKE.md

Use Snowflake only from server-side Worker code after `requireAuth()`. Do not commit credentials, expose `SNOWFLAKE_*` values to browser code, or tell the user to configure deployed Snowflake secrets with Wrangler or the Cloudflare dashboard.

### Tailwind CSS v4 caveat

Do NOT use `max-w-sm`, `max-w-md`, `max-w-lg`, etc. This project defines custom spacing tokens that conflict with Tailwind v4's resolution order. Use explicit values instead:

```tsx
// Bad — resolves to spacing token (24px) instead of expected 512px
<div className="max-w-lg">

// Good
<div className="max-w-[32rem]">
```

## CI/CD

- **GitHub Actions** deploys to production on every push to `main`
- The workflow runs `pnpm install`, applies D1 migrations, then deploys via wrangler
- The `CLOUDFLARE_API_TOKEN` secret is already configured on the `deploy` GitHub environment (restricted to `main`)
- The `OPENROUTER_API_KEY` Worker secret is managed by Zeus and can be rotated from the run page
- D1 migrations live in `migrations/` and are applied automatically before deploy

### Adding a migration

Create a new file in `migrations/` with the next sequence number:

```
migrations/0002_add_my_table.sql
```

Migrations run in order and are tracked automatically by D1.

## Development

```bash
pnpm install
npx wrangler d1 migrations apply DB --local   # Set up local database
pnpm dev          # Start local dev server on port 3000
pnpm typecheck    # Type check
```

## Structured Logging

All server-side code uses the structured logger (`src/lib/logger.ts`). Logs are forwarded to Datadog via the `zeus-log-drain` tail worker.

```ts
import { createLogger, runWithLogContext } from './lib/logger'
const log = createLogger('my-module')

// Basic logging — fields nest under a `data` sub-object to avoid key conflicts
log.info('step completed', { stepKey, durationMs })
// emits: { level: "info", source: "my-module", event: "step completed", data: { stepKey, durationMs } }

log.error('step failed', { stepKey, error: err.message })

// Child loggers bind extra context under data
const childLog = log.child({ jobId: '123' })
childLog.info('started') // data: { jobId: "123" }

// ALS context propagation — all downstream logs inherit these fields under data
runWithLogContext({ requestId, userId }, async () => {
  log.info('anything here includes requestId and userId in data automatically')
})
```

### Key patterns

- **Three top-level structural keys**: `level`, `source`, `event` — everything else goes in `data`
- **`source`** maps to the `@source` Datadog facet — use the module name you want to filter on
- **`event`** is the first argument to `log.info()` — a short, stable label (e.g. `'request'`, `'job started'`)
- **ALS context** (`runWithLogContext`) automatically injects fields like `requestId` into every log line within the call-tree — use it at request/job boundaries
- **Never log at the top level** — always use `createLogger(source)` so logs carry the source facet

## Project Structure

```
├── src/
│   ├── lib/
│   │   ├── auth.server.ts    # Auth helpers (DO NOT modify without reason)
│   │   └── logger.ts         # Structured JSON logger (ALS context, Datadog)
│   ├── routes/
│   │   ├── __root.tsx         # Root layout
│   │   ├── index.tsx          # Main page
│   │   ├── -index.api.ts      # Server functions (API layer)
│   │   └── auth/
│   │       └── callback.tsx   # Auth callback (DO NOT modify)
│   └── styles/
│       └── global.css         # Tailwind config + theme tokens
├── migrations/                # D1 SQL migrations
├── wrangler.json              # Cloudflare Worker config
└── .oxfmtrc.json              # Formatter config
```

## Conventions

- No semicolons
- Single quotes
- 2-space indentation
- Use `interface` over `type` for object shapes
- Server functions go in `-*.api.ts` files alongside their route (the `-` prefix tells TanStack Router to ignore them)
- Always protect server functions with auth checks
