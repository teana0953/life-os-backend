## Why

The chaodays import fails from production because chaodays sits behind Cloudflare
and its edge blocks requests that originate from a **Cloudflare Worker** (the CF
egress ASN). This was confirmed empirically: the exact same `sign_in` request
returns a clean `401` from a residential IP and from an AWS Lightsail IP, but the
Worker's subrequest is blocked. A realistic `User-Agent` (already sent) does not
help — the block is on the source network, not the UA.

Since chaodays is a third-party app the user does not control, its firewall can't
be changed. The fix is to route the Worker's chaodays calls through a small
self-hosted **reverse-proxy relay** on a non-Cloudflare host (an existing AWS
Lightsail box running Caddy), so chaodays sees an AWS source IP instead of a CF
Worker. A Cloudflare Worker's `fetch` cannot use an outbound HTTP/CONNECT proxy,
so a reverse-proxy relay (not a forward proxy) is the only shape that works.

## What Changes

- **`HttpChaodaysClient` base URL becomes injectable + an optional relay secret.**
  The constructor keeps `fetchImpl` as its first argument and gains an options
  object `{ baseUrl?, relaySecret? }`. `baseUrl` defaults to the current direct
  `https://api.chaodays.app/api/v1` (so existing tests and un-configured
  environments are unchanged). When `relaySecret` is set, every request carries an
  `X-Relay-Secret: <secret>` header so the relay can reject anything else.
- **Composition root wires the relay from env.** `src/index.ts` reads two new
  optional Workers env vars — `CHAODAYS_RELAY_BASE` and `CHAODAYS_RELAY_SECRET`.
  When `CHAODAYS_RELAY_BASE` is set the client is built pointing at the relay
  (with the secret header); otherwise it falls back to the direct chaodays URL.
  Because it now depends on `env`, `chaodaysClient` moves from module scope into
  the `fetch` handler (like `pushSender`).
- **`.dev.vars.example` + `Env` type** document the two new optional vars.
- **`relay/Caddyfile` + `relay/README.md`** (a reproducible, checked-in
  deliverable — **not** Pulumi/IaC). The Caddyfile serves a `nip.io` host with
  automatic Let's Encrypt TLS, requires a matching `X-Relay-Secret` header, and
  `reverse_proxy`es to `https://api.chaodays.app` with `header_up Host
  api.chaodays.app`; requests without the secret get `403` (so the relay is never
  an open proxy). The README records the one-time manual box setup (install Caddy,
  attach a static IP, open ports 80/443, fill in the host + secret) and the two
  Worker secrets.

Backend only. **No** change to import logic, endpoints, error mapping, or the
chaodays API contract — only where the egress goes. **No** Pulumi / `life-os-infra`
change; **no** change to chaodays itself. The Lightsail provisioning (boot, install
Caddy, static IP, firewall) is done manually by the user per the README — this
change does not automate it. Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `chaodays-import`: adds a requirement that egress to chaodays goes through a
  configurable relay when one is provisioned, defaulting to a direct connection
  otherwise — with the relay authenticated by a shared secret header. The existing
  import behavior, auth handling, and error contract are unchanged.
