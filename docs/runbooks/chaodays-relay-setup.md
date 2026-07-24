# Runbook — chaodays relay setup (existing Caddy box)

Step-by-step to stand up the chaodays egress relay on the **existing** Lightsail
box that **already runs Caddy and other services**. We **add one site block** to
the current Caddy config — we do **not** install a second Caddy or replace the
existing config. Caddy serves many sites on 80/443 by Host/SNI, so an extra site
block coexists with whatever is already there.

Background & rationale: see `relay/README.md` and the change `add-chaodays-relay`.
The relay only proxies to `api.chaodays.app`, only for callers with the shared
secret, and strips the secret before forwarding.

Prereqs: SSH access to the box; ability to edit the Lightsail console (static IP +
firewall); repo access to set GitHub secrets.

---

## Step 0 — Discover the current Caddy layout (run on the box)

```sh
caddy version
# Is Caddy a systemd service, and which config file does it load?
systemctl cat caddy 2>/dev/null | grep -E 'ExecStart|--config'
# Default is /etc/caddy/Caddyfile. Note the real path from the line above as $CADDYFILE.
# Does the config pull in a sites directory via `import`?
sudo grep -nE '^\s*import' /etc/caddy/Caddyfile 2>/dev/null || echo "(no import lines)"
# Confirm Caddy already owns 80 + 443 (so the firewall is already open for them):
sudo ss -ltnp | grep -E ':80 |:443 ' || echo "(check which process holds 80/443)"
```

Outcome — you now know:
- **A.** config is one file (`$CADDYFILE`, usually `/etc/caddy/Caddyfile`) → we
  **append** a site block, **or**
- **B.** the config has `import sites/*.caddy` (or similar) → we **drop a snippet
  file** into that directory instead.

If unsure, paste the output back and I'll tell you which.

---

## Step 1 — Static IP + the nip.io hostname

The nip.io hostname and its TLS cert are bound to the box's public IP; it **must**
be a Lightsail **static IP** or a reboot breaks the relay.

1. Lightsail console → **Networking** → **Attach static IP** to this instance (skip
   if one is already attached). Note the IP.
2. On the box, confirm the public IP and derive the host (dots → dashes):

```sh
curl -s ifconfig.me; echo
# e.g. 13.52.1.2  ->  host = 13-52-1-2.nip.io
```

Record `HOST=<ip-dashed>.nip.io`.

---

## Step 2 — Firewall (verify, likely already open)

Because the existing Caddy already serves HTTPS, **443** is almost certainly open
in Lightsail. **80** must also be open (Let's Encrypt HTTP-01 challenge for the new
host). Lightsail console → **Networking → IPv4 Firewall**: ensure both **80** and
**443** (TCP) are present. No change needed if they already are.

---

## Step 3 — Generate the shared secret

```sh
openssl rand -hex 32
```

Record it as `RELAY_SECRET`. It goes in two places: the Caddy site block (Step 4)
and the Worker's GitHub secret (Step 6). They must match exactly.

---

## Step 4 — Add the relay site block to the existing Caddy

Use the block from `relay/Caddyfile`, substituting `HOST` and `RELAY_SECRET`:

```caddyfile
HOST {
    @authed header X-Relay-Secret "RELAY_SECRET"
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
```

**Variant A — single Caddyfile:** append the block to the **end** of `$CADDYFILE`
(a new top-level site block, outside any existing site's braces).

**Variant B — `import` / sites dir:** create a new file in the imported directory,
e.g. `/etc/caddy/sites/chaodays-relay.caddy`, containing just the block.

Then validate, reload, and watch the cert get issued:

```sh
sudo caddy validate --config "$CADDYFILE"      # syntax check before reloading
sudo systemctl reload caddy                     # zero-downtime; existing sites unaffected
sudo journalctl -u caddy -f | grep -i "$HOST"   # wait for "certificate obtained" for HOST, then Ctrl-C
```

> If validate/reload errors, the existing sites keep running on the old config
> (reload is atomic). Fix the block and reload again.

---

## Step 5 — Verify the relay (from the box or anywhere)

```sh
# With the secret: chaodays' own 401 (bad creds) comes back through the relay.
curl -si "https://$HOST/api/v1/users/sign_in" \
  -H "X-Relay-Secret: $RELAY_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"user":{"uid":"x","password":"wrong"}}' | head -1

# Without the header: the relay rejects with 403, never reaching chaodays.
curl -si "https://$HOST/api/v1/users/sign_in" \
  -H 'Content-Type: application/json' \
  -d '{"user":{"uid":"x","password":"wrong"}}' | head -1
```

Expected: first → `HTTP/2 401`; second → `HTTP/2 403`. If the first is 403, the
secret in the site block doesn't match the header; if TLS fails, the cert hasn't
finished issuing (re-check Step 4's journal) or 80 is closed (Step 2).

---

## Step 6 — Worker side (GitHub secrets, Model A)

Set both on the `life-os-backend` repo (GitHub is the single source of truth; CD
uploads them via wrangler on deploy):

- `CHAODAYS_RELAY_BASE` = `https://<HOST>/api/v1` (a non-secret value — a repo
  **variable** or secret)
- `CHAODAYS_RELAY_SECRET` = the `RELAY_SECRET` from Step 3 (a repo **secret**)

Ensure `deploy.yml` uploads them (`wrangler secret put CHAODAYS_RELAY_SECRET`, and
`CHAODAYS_RELAY_BASE` as a var/secret). Then merge PR #35 (or redeploy). When
`CHAODAYS_RELAY_BASE` is unset the backend calls chaodays directly, so nothing
breaks until both are set.

Final check: run a real chaodays import in the app — it should now succeed instead
of failing with `chaodays_unavailable`.

---

## Rollback

- **Relay off:** unset `CHAODAYS_RELAY_BASE` (GitHub) and redeploy → backend goes
  back to calling chaodays directly (which fails from the Worker, but nothing else
  is affected).
- **Remove the site block:** delete the block (Variant A) or the snippet file
  (Variant B), `sudo caddy validate` + `sudo systemctl reload caddy`. Other sites
  are untouched.
