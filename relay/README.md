# chaodays relay

## Purpose

chaodays sits behind Cloudflare, and its edge blocks requests originating from
a **Cloudflare Worker** (the CF egress ASN) — confirmed empirically, a
realistic `User-Agent` doesn't help. Since chaodays is a third party we don't
control, the fix is to route the Worker's chaodays calls through this small
Caddy reverse-proxy relay running on an existing AWS Lightsail box, so
chaodays sees the box's AWS IP instead of a Cloudflare Worker IP.

This is a checked-in, reproducible config — **not** Pulumi/IaC. The box
itself and its provisioning are managed manually.

`Caddyfile` in this directory is **one site block**, meant to be **added to the
box's existing Caddy config** — the box already runs Caddy and other services, so
we coexist (Caddy serves many sites on 80/443 by Host), not replace.

## Setup

Full step-by-step (discovery, static IP, adding the site block to the existing
Caddy, verification, GitHub secrets, rollback):

**→ `docs/runbooks/chaodays-relay-setup.md`**

In short: attach a static IP, add this site block to the existing Caddy (append to
the main Caddyfile or drop into the imported sites dir) with the placeholders
filled in (`<ip-dashed>.nip.io` host + an `openssl rand -hex 32` secret),
`caddy validate` + `systemctl reload caddy`, then verify with the two curls in the
runbook (secret → chaodays `401`; no secret → relay `403`).

## Worker side

Set two Worker env vars via GitHub (Model A: GitHub is the single source of
truth; CD uploads them with `wrangler`):

- `CHAODAYS_RELAY_BASE=https://<host>.nip.io/api/v1` (a GitHub variable/secret,
  non-secret value)
- `CHAODAYS_RELAY_SECRET=<secret>` (a GitHub secret; uploaded with
  `wrangler secret put CHAODAYS_RELAY_SECRET`)

When `CHAODAYS_RELAY_BASE` is unset, the backend falls back to calling
chaodays directly.

## Security posture

The relay only proxies to a single fixed upstream (`api.chaodays.app`) and
only for callers presenting the correct `X-Relay-Secret` header — it can
never be used as an open proxy. The secret is stripped
(`header_up -X-Relay-Secret`) before the request is forwarded upstream, so it
never reaches chaodays (a third party).
