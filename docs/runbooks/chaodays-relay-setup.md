# Runbook — chaodays relay setup (Dockerized Caddy on the `flow` box)

Stand up the chaodays egress relay on the Lightsail box that already runs Caddy in
Docker (a compose project at `/opt/flow`, alongside other, unrelated sites). We
**add one site block** to the existing `/opt/flow/Caddyfile` — Caddy serves many
sites on 80/443 by Host, so the relay coexists with the current services. We do
**not** replace anything or run a second Caddy.

Why a relay: chaodays sits behind Cloudflare and blocks requests originating from a
Cloudflare Worker (confirmed — an AWS IP gets a clean 401, the Worker is blocked).
The relay makes the Worker's chaodays calls egress from this box's AWS IP. The relay
only proxies to `api.chaodays.app`, only for callers with the shared secret, and
strips the secret before forwarding.

This box (discovered facts):
- Caddy container: **`flow-caddy-1`** (`caddy:2`), publishes `0.0.0.0:80` + `:443`.
- Config: bind mount **`/opt/flow/Caddyfile`** → `/etc/caddy/Caddyfile` (single file).
- Cert storage: `flow_caddy_data` volume (persistent).
- Existing `/opt/flow/Caddyfile`: a global `{ email … }` block + the other sites.
- Relay host: the box's static **public IPv4** as a dashed `nip.io` name — write it
  `<ip-dashed>.nip.io` (e.g. `1.2.3.4` → `1-2-3-4.nip.io`). Derive it on the box with
  `curl -s -4 ifconfig.me`.

All commands run on the box; `docker` needs `sudo`; the box shell is ASCII-only.
`<ip-dashed>.nip.io` below is a placeholder — substitute the box's actual dashed IP.

---

## Step 1 — Static IP (verify)

The nip.io host + its cert are bound to the box's static public IPv4; it must be a Lightsail
**static IP** or a reboot breaks the relay. Lightsail console → Networking →
confirm a static IP is attached to this instance. (Ports 80/443 are already open —
the existing Caddy serves them.)

## Step 2 — Generate the shared secret

```sh
openssl rand -hex 32
```

Keep the output — it goes in the Caddy site block (Step 3) and the Worker's GitHub
secret (Step 6). They must match exactly.

## Step 3 — Append the relay site block to `/opt/flow/Caddyfile`

Append this block to the **end** of the file (a new top-level site block, after the
existing site blocks; the leading `{ email … }` global block stays first):

```sh
sudo tee -a /opt/flow/Caddyfile >/dev/null <<'EOF'

<ip-dashed>.nip.io {
        @authed header X-Relay-Secret "PASTE_SECRET_HERE"
        handle @authed {
                reverse_proxy https://api.chaodays.app {
                        header_up Host api.chaodays.app
                        header_up -X-Relay-Secret
                }
        }
        handle {
                respond 403
        }
}
EOF
```

Then replace the placeholder with the real secret (avoids putting the secret in
shell history):

```sh
sudo nano /opt/flow/Caddyfile   # change PASTE_SECRET_HERE -> the Step 2 secret, save
```

## Step 4 — Validate + reload (zero-downtime)

```sh
sudo docker exec flow-caddy-1 caddy validate --config /etc/caddy/Caddyfile
sudo docker exec flow-caddy-1 caddy reload   --config /etc/caddy/Caddyfile
sudo docker logs -f flow-caddy-1   # watch for "certificate obtained" for <ip-dashed>.nip.io, then Ctrl-C
```

Reload is atomic — if validate/reload errors, the other sites keep running on
the old config; fix the block and reload again.

> **Gotcha (hit in practice):** `caddy reload` can report `config is unchanged`
> and NOT load a newly-added site block, so Caddy never requests its cert — TLS
> then fails with `internal error` / no peer certificate, and the logs show NO
> `obtaining certificate` line for the new host. Fix: force a clean load with
> `sudo docker restart flow-caddy-1` (a few seconds' blip on the other sites),
> then re-check logs — the cert is obtained on startup.
>
> **DNS choice — prefer `sslip.io` over `nip.io`.** `nip.io` is heavily shared and
> can hit Let's Encrypt rate limits ("too many certificates already issued");
> `<ip-dashed>.sslip.io` is a separate wildcard-DNS domain and issued cleanly here.
> Caddy also falls back to ZeroSSL automatically if Let's Encrypt fails.

## Step 5 — Verify the relay

```sh
# With the secret -> chaodays' own 401 (bad creds) comes back through the relay:
curl -si https://<ip-dashed>.nip.io/api/v1/users/sign_in \
  -H "X-Relay-Secret: <secret>" \
  -H 'Content-Type: application/json' \
  -d '{"user":{"uid":"x","password":"wrong"}}' | head -1

# Without the header -> the relay rejects with 403, never reaching chaodays:
curl -si https://<ip-dashed>.nip.io/api/v1/users/sign_in \
  -H 'Content-Type: application/json' \
  -d '{"user":{"uid":"x","password":"wrong"}}' | head -1
```

Expected: first `HTTP/2 401`, second `HTTP/2 403`. If the first is 403 → the secret
in the block ≠ the header; if TLS fails → the cert hasn't finished issuing (re-watch
Step 4 logs).

## Step 6 — Worker side (GitHub secrets, Model A)

On the `life-os-backend` repo (GitHub is the source of truth; CD uploads via
wrangler):

- `CHAODAYS_RELAY_BASE` = `https://<ip-dashed>.nip.io/api/v1`
- `CHAODAYS_RELAY_SECRET` = the Step 2 secret

Ensure `deploy.yml` pushes both to the Worker, then merge PR #35 (or redeploy).
While `CHAODAYS_RELAY_BASE` is unset the backend calls chaodays directly, so nothing
breaks until both are set. Final check: run a real chaodays import in the app.

---

## Rollback

- **Relay off:** unset `CHAODAYS_RELAY_BASE` in GitHub + redeploy → backend calls
  chaodays directly again.
- **Remove the site block:** delete the appended block from `/opt/flow/Caddyfile`,
  then `sudo docker exec flow-caddy-1 caddy validate --config /etc/caddy/Caddyfile`
  + `caddy reload`. The other sites are untouched.
