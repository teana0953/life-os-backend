# chaodays relay

## Purpose

chaodays sits behind Cloudflare, and its edge blocks requests originating from
a **Cloudflare Worker** (the CF egress ASN) — confirmed empirically, a
realistic `User-Agent` doesn't help. Since chaodays is a third party we don't
control, the fix is to route the Worker's chaodays calls through this small
Caddy reverse-proxy relay running on an existing AWS Lightsail box, so
chaodays sees the box's AWS IP instead of a Cloudflare Worker IP.

This is a checked-in, reproducible config — **not** Pulumi/IaC. The box
itself and its provisioning are managed manually per the steps below.

## One-time manual setup (existing Lightsail box)

1. **Attach a static IP** to the instance in the Lightsail console. The
   `nip.io` hostname (and its Let's Encrypt certificate) are bound to this IP
   — without a static IP, a reboot changes the IP and breaks the relay.
2. **Open firewall ports 80 and 443** for the instance in the Lightsail
   networking tab (80 is needed for the ACME HTTP challenge; 443 for the
   relay itself).
3. **Install Caddy** on the box (see https://caddyserver.com/docs/install).
4. **Drop in `Caddyfile`** (this directory), replacing the placeholders:
   - `REPLACE_WITH_IP_DASHED` → the box's static IP with dots replaced by
     dashes, e.g. IP `13.52.1.2` → `13-52-1-2.nip.io`.
   - `REPLACE_WITH_RELAY_SECRET` → a strong generated secret, e.g.
     `openssl rand -hex 32`.
5. **Reload Caddy** (`sudo systemctl reload caddy` or equivalent) to pick up
   the new config and mint the certificate.
6. **Verify:**
   ```sh
   # With the correct secret: chaodays' own 401 for bad creds comes through.
   curl -i https://<host>.nip.io/api/v1/users/sign_in \
     -H 'X-Relay-Secret: <secret>' \
     -H 'Content-Type: application/json' \
     -d '{"user":{"uid":"x","password":"wrong"}}'

   # Without the header: the relay itself rejects with 403, never reaching chaodays.
   curl -i https://<host>.nip.io/api/v1/users/sign_in \
     -H 'Content-Type: application/json' \
     -d '{"user":{"uid":"x","password":"wrong"}}'
   ```

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
