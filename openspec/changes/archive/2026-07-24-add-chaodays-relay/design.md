# Design — chaodays relay egress

## Context

`import from chaodays` calls `https://api.chaodays.app/api/v1` from a Cloudflare
Worker. chaodays is a third-party Rails app **behind Cloudflare** that the user
does not control. Its edge blocks requests originating from a Cloudflare Worker.

**Evidence (2026-07-24):**
- Local (residential IP) `POST /users/sign_in` with bad creds → clean `401` JSON.
- AWS Lightsail IP, same request → clean `401` (over HTTP/1.1; an HTTP/2 client
  quirk produced a false `PROTOCOL_ERROR` first, ruled out with `--http1.1`).
- The Worker's subrequest is blocked. A realistic `User-Agent` is already sent and
  does not help — the block is on the source network (CF ASN), not the UA.

Conclusion: any non-Cloudflare egress fixes it. The user has an existing Lightsail
box, so we relay through it.

## Decision

Route the Worker's chaodays requests through a **Caddy reverse-proxy relay** on the
Lightsail box. Not a forward proxy: a Cloudflare Worker's `fetch` cannot use an
outbound HTTP/CONNECT proxy, so the only workable shape is the Worker calling the
relay's URL, and the relay re-issuing the request to chaodays from its AWS IP.

```
Worker ──HTTPS──▶ https://<ip-dashed>.nip.io/api/v1/...   (X-Relay-Secret)
  Caddy relay ──HTTPS──▶ https://api.chaodays.app/api/v1/...  (Host: api.chaodays.app)
  ◀── status + body + rotating access-token/client/uid headers ──
```

### Alternatives considered

- **Pulumi in `life-os-infra`:** rejected. The box already exists and is not
  Pulumi-managed; the meaningful part is in-box config (Caddy), which is
  provisioning, not resource declaration; and it would cross the CF-only Model A
  boundary by pulling AWS into Pulumi. For one personal relay that is over-build.
  The Caddyfile + README are checked into the repo for reproducibility instead.
- **Adjust chaodays' Cloudflare:** impossible — third-party, not the user's.
- **Self-written Node/Go relay:** more code + manual TLS; Caddy does it in ~15
  lines with automatic HTTPS.

## Components

### 1. `HttpChaodaysClient` (code)

Constructor keeps `fetchImpl` first (so `new HttpChaodaysClient(fakeFetch)` in
existing tests is untouched) and adds an options object:

```ts
constructor(
  private readonly fetchImpl: typeof fetch = fetch,
  { baseUrl, relaySecret }: { baseUrl?: string; relaySecret?: string } = {},
) { this.baseUrl = baseUrl ?? DIRECT_BASE_URL; this.relaySecret = relaySecret; }
```

- All endpoint URLs use `this.baseUrl` instead of the module `BASE_URL` constant.
- The private `request` adds `X-Relay-Secret: this.relaySecret` **only when set**.
- Never logged (same rule as the existing credential/session headers).

Default construction (`new HttpChaodaysClient()`) is byte-for-byte the current
behavior: direct URL, no relay header.

### 2. Composition root (`src/index.ts`)

`chaodaysClient` moves into the `fetch` handler because it now reads `env`:

```ts
const chaodaysClient = env.CHAODAYS_RELAY_BASE
  ? new HttpChaodaysClient(undefined, {
      baseUrl: env.CHAODAYS_RELAY_BASE,
      relaySecret: env.CHAODAYS_RELAY_SECRET,
    })
  : new HttpChaodaysClient();
```

`Env` gains optional `CHAODAYS_RELAY_BASE` and `CHAODAYS_RELAY_SECRET`.

### 3. Relay (`relay/Caddyfile`, `relay/README.md`) — checked-in, non-IaC

```caddyfile
<ip-dashed>.nip.io {
    @authed header X-Relay-Secret "<RELAY_SECRET>"
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

Caddy auto-provisions a Let's Encrypt cert for the `nip.io` host (no domain
needed). It preserves request path/query/body and passes chaodays' response
headers back — including the **rotating** `access-token`/`client`/`uid` that the
client reads from each response. The relay forwards only to chaodays (single
upstream) and only for callers with the secret, so it is never an open proxy.

Two details from proposal review, folded in: the unauthenticated fallback is a
`handle { respond 403 }` block (not a bare `respond 403`) so directive ordering
can't make authed requests 403 too; and `header_up -X-Relay-Secret` strips the
shared secret before forwarding so it never leaks to chaodays (a third party).
Note: the 403 guard lives entirely in the Caddyfile, so it is verified manually on
the box, not by the code gate — only the two client-side scenarios are gate-proven.

## Risks / trade-offs

- **Static IP required.** The `nip.io` host and the cert are bound to the box's
  public IP; it must be a Lightsail static IP or a reboot breaks the relay. Noted
  in the README; provisioning is manual.
- **Credentials transit the relay.** Worker→relay and relay→chaodays are both
  HTTPS, but the relay terminates TLS and briefly holds plaintext creds/token in
  memory. Acceptable: it is the user's own box; Caddy does not log bodies.
- **New single point of failure.** If the box is down, import fails (502
  `chaodays_unavailable`, same as any upstream outage). Acceptable for a personal
  tool.
- **Secret leak blast radius is small.** The relay only proxies to chaodays (a
  public API); the secret prevents anonymous abuse/bandwidth, nothing more.

## Out of scope

Import logic, endpoints, error mapping, the chaodays contract, any frontend, any
Pulumi/`life-os-infra` change, and automating the box provisioning.
