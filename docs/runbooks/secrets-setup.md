# Runbook — CI/CD Secrets Setup

Set the GitHub Actions secrets and variable that the CD workflow
(`.github/workflows/deploy.yml`) needs before merging to `main`. Without them,
the first deploy run fails at the migration or deploy step.

> **Leak safety:** never paste a secret value into a chat, PR, issue, or commit.
> Enter values only in the GitHub UI or via `gh` interactive prompts (below).
> All four are stored as GitHub **encrypted secrets**; `PRODUCTION_URL` is a
> plain **variable** (not sensitive).

## What to set

| Name | Kind | Sensitive? | Used by |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | **yes** | deploy step (auth to Cloudflare) |
| `CLOUDFLARE_ACCOUNT_ID` | secret | no¹ | deploy step (target account) |
| `DATABASE_URL` | secret | **yes** | migration + Worker runtime |
| `FIREBASE_PROJECT_ID` | secret | no¹ | Worker runtime (token `aud`/`iss` check) |
| `PRODUCTION_URL` | variable | no | smoke test target |

¹ Account ID and Firebase project ID are not secret, but the workflow reads them
from the `secrets.*` context, so they must be stored as secrets to be referenced.

## Where to get each value

### `CLOUDFLARE_API_TOKEN`
1. Cloudflare dashboard → **My Profile → API Tokens → Create Token**.
2. Use the **"Edit Cloudflare Workers"** template (grants Workers Scripts: Edit,
   which covers both `wrangler deploy` and `wrangler secret put`).
3. Under **Account Resources**, scope it to the account that will host the Worker.
4. Create, copy the token **once** (it is not shown again).

### `CLOUDFLARE_ACCOUNT_ID`
- `npx wrangler whoami` (shows the account ID), **or**
- Cloudflare dashboard → **Workers & Pages** → the Account ID is in the right sidebar.

### `DATABASE_URL`
- [Neon console](https://console.neon.tech) → your project → **Connection Details**
  → copy the connection string. Ensure it ends with `?sslmode=require`
  (the `@neondatabase/serverless` driver needs TLS).

### `FIREBASE_PROJECT_ID`
- Firebase console → **Project settings** (gear icon) → **Project ID**.

### `PRODUCTION_URL`
- The deployed Worker URL: `https://life-os-backend.<your-subdomain>.workers.dev`.
- Find `<your-subdomain>` in Cloudflare dashboard → **Workers & Pages** (shown as
  `<subdomain>.workers.dev`), **or** read it from the first deploy log.
- See the [first-deploy chicken-and-egg](#first-deploy-chicken-and-egg) note below
  if you don't know it yet.

## How to set them

### Option A — GitHub web UI
Repo → **Settings → Secrets and variables → Actions**.

- **Secrets** tab → **New repository secret** → add each of the four secrets.
- **Variables** tab → **New repository variable** → add `PRODUCTION_URL`.

### Option B — `gh` CLI (values never echoed)
Run from the repo directory. Each `gh secret set` prompts for the value with a
hidden input:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set DATABASE_URL
gh secret set FIREBASE_PROJECT_ID
gh variable set PRODUCTION_URL   # e.g. https://life-os-backend.<subdomain>.workers.dev
```

> In this Claude Code session, prefix with `!` so the hidden prompt runs in your
> terminal (`! gh secret set DATABASE_URL`) — the value stays local.

## Verify

```bash
gh secret list      # should list the 4 secret names (values never shown)
gh variable list     # should list PRODUCTION_URL with its value
```

## First-deploy chicken-and-egg

`PRODUCTION_URL` points at a Worker that doesn't exist until the first deploy.
Two ways to handle it:

- **Know your subdomain up front:** set `PRODUCTION_URL` to
  `https://life-os-backend.<subdomain>.workers.dev` before merging. Deploy +
  smoke test both pass on the first run.
- **Don't know it yet:** merge without `PRODUCTION_URL`. Migration + deploy
  succeed; the smoke test step fails with an explicit "PRODUCTION_URL not set"
  message. Read the deploy log for the real URL, set the variable, then
  **re-run the failed job** (Actions → the run → **Re-run failed jobs**).

## After setup

Merge PR #1. The push to `main` triggers `deploy.yml`:
migrate → deploy → smoke test (`/health` 200, `/api/me` no-token 401).
Watch it: `gh run watch` (or Actions tab).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy step: `Authentication error` / 10000 | bad/expired `CLOUDFLARE_API_TOKEN` or wrong `CLOUDFLARE_ACCOUNT_ID` | re-create token with "Edit Cloudflare Workers"; recheck account id |
| Migration step fails to connect | `DATABASE_URL` wrong or missing `?sslmode=require` | recopy from Neon, ensure TLS param |
| Smoke test: `/health` returns 503 | Worker runtime `DATABASE_URL` not uploaded, or DB unreachable | confirm the deploy step's `secrets:`+`env:` mapping; check Neon is awake |
| Smoke test: "PRODUCTION_URL not set" | variable missing | set `PRODUCTION_URL`, re-run failed job |
| Deploy succeeded but behavior wrong | no auto-rollback | revert the offending commit on `main` (re-triggers a clean deploy) |

## Rotation

To rotate a secret (e.g. leaked Cloudflare token or Neon password): create the new
value at the source, update it via Option A or B, then push any commit to `main`
(or re-run the latest deploy) so the Worker picks up the new runtime secrets.
GitHub remains the single source of truth — no manual `wrangler secret put` needed.
