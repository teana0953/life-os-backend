# life-os-backend

Backend for Life OS — a Cloudflare Workers API built with Hono, backed by
Neon PostgreSQL and Firebase Auth. This repo currently contains the
**walking skeleton**: the minimal end-to-end setup proving Workers ↔ Neon ↔
Firebase Auth fit together, before any real business modules are added.

See [`CLAUDE.md`](./CLAUDE.md) for the architecture conventions (hexagonal
layering, context-first structure, naming) that all future modules must
follow.

## Stack

- **Runtime**: Cloudflare Workers (TypeScript), [Hono](https://hono.dev)
- **Database**: Neon PostgreSQL via `@neondatabase/serverless` (HTTP driver)
  + [Drizzle ORM](https://orm.drizzle.team)
- **Auth**: Firebase ID token verification via `jose` (no firebase-admin —
  it's not Workers-compatible)
- **Tests**: Vitest — plain unit tests for domain/application, and
  `@cloudflare/vitest-pool-workers` (runs inside `workerd`) for
  infrastructure/HTTP layers

## Endpoints

- `GET /health` — public. Pings the database. `200 { "ok": true }` if
  healthy, `503 { "ok": false }` if the database is unreachable.
- `GET /api/me` — protected (`Authorization: Bearer <Firebase ID token>`).
  Get-or-creates the user record for the verified identity and returns its
  profile as JSON. `401 { "error": "unauthorized" }` if the token is
  missing/invalid.

## Local development

### Prerequisites

- Node.js
- A Neon Postgres database
- A Firebase project (for its project ID; ID tokens are verified against
  Google's public JWKS, no service account credentials needed)

### Setup

```bash
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars with your Neon DATABASE_URL and FIREBASE_PROJECT_ID
```

`.dev.vars` is gitignored — never commit real secrets.

### Run

```bash
npm run dev       # wrangler dev, reads .dev.vars locally
npm test          # vitest: unit + workers projects
npm run typecheck # tsc --noEmit
```

## Database migrations

Schema lives in `src/shared/db/schema.ts`. Migrations are managed by
`drizzle-kit` and generated into `drizzle/`.

```bash
npm run db:generate   # generate a new migration from schema changes
```

Migrations are plain SQL files under `drizzle/`; apply them to your Neon
database with your preferred method (e.g. `psql "$DATABASE_URL" -f drizzle/<file>.sql`,
or a drizzle-kit migrate script wired to `DATABASE_URL`).

## Secrets

`DATABASE_URL` and `FIREBASE_PROJECT_ID` are read from Workers environment
bindings and are never committed to the repo:

- **Local dev**: set them in `.dev.vars` (see `.dev.vars.example`).
- **Deployed environments**: set them with Wrangler secrets:

  ```bash
  npx wrangler secret put DATABASE_URL
  npx wrangler secret put FIREBASE_PROJECT_ID
  ```

## Deploy

```bash
npx wrangler deploy
```

After deploying, verify:

- `GET /health` returns `200 { "ok": true }`.
- `GET /api/me` with no token returns `401`.
- `GET /api/me` with a valid Firebase ID token returns the user JSON, and a
  corresponding row exists in the `users` table in Neon.

## CI/CD

GitHub Actions runs two workflows:

- **CI** (`.github/workflows/ci.yml`) — on every pull request and every push
  to a branch other than `main`: `npm ci`, `npm run typecheck`, `npm test`.
  A failing type-check or test suite fails the run.
- **Deploy** (`.github/workflows/deploy.yml`) — on every push to `main`:
  runs database migrations (`npm run db:migrate`), then deploys the Worker
  to Cloudflare with `cloudflare/wrangler-action` (which also uploads the
  Worker's runtime secrets from GitHub), then runs a post-deploy smoke test
  (`GET /health` expects `200`, `GET /api/me` with no token expects `401`).
  If migrations fail, the deploy step never runs. Workflow YAML is checked
  with `actionlint` (`npm run lint:actions`) as part of the quality gate.

### Required GitHub configuration

Set these under the repo's **Settings → Secrets and variables → Actions**:

**Secrets** (tab: Secrets):

| Secret | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploy authentication (Cloudflare dashboard → API Tokens → "Edit Cloudflare Workers" template) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identification |
| `DATABASE_URL` | Running migrations and as a Worker runtime secret (Neon connection string) |
| `FIREBASE_PROJECT_ID` | Worker runtime secret (token verification) |

**Variables** (tab: Variables):

| Variable | Used for |
|---|---|
| `PRODUCTION_URL` | Base URL the post-deploy smoke test curls (e.g. `https://life-os-backend.<subdomain>.workers.dev`) |

`DATABASE_URL` and `FIREBASE_PROJECT_ID` are pushed to the Worker on every
deploy from these GitHub secrets, so there's no separate manual
`wrangler secret put` step for deployed environments — GitHub is the single
source of truth for runtime config.

### Deploy failures

Cloudflare Workers has no automatic rollback. If the smoke test fails after
a deploy, the previous code is **not** restored automatically — the failed
workflow run is a signal to investigate and either push a fix or manually
redeploy a known-good commit (`git checkout <good-sha> -- . && npx wrangler
deploy`, or re-run the `Deploy` workflow from that commit).
