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
