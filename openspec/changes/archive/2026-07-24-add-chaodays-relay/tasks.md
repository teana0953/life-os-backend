# Tasks

## 1. Make `HttpChaodaysClient` base URL + relay secret injectable (TDD)

- [ ] Test: constructed with `{ baseUrl, relaySecret }`, `signIn` and a data fetch
      target the given base URL (not the direct chaodays URL) and every request
      carries `X-Relay-Secret: <relaySecret>`.
- [ ] Test: constructed with no options (default), requests still target
      `https://api.chaodays.app/api/v1` and carry **no** `X-Relay-Secret` header
      (existing behavior unchanged — existing tests stay green).
- [ ] Implement: constructor `(fetchImpl = fetch, { baseUrl, relaySecret } = {})`;
      store `this.baseUrl` (default `https://api.chaodays.app/api/v1`) and
      `this.relaySecret`. Replace the module `BASE_URL` uses with `this.baseUrl`.
      In the private `request`, add `X-Relay-Secret` to the headers only when
      `relaySecret` is set. Do not log the secret (consistent with the existing
      no-log-headers rule).

## 2. Wire the relay from env in the composition root

- [ ] `src/index.ts`: add optional `CHAODAYS_RELAY_BASE` and
      `CHAODAYS_RELAY_SECRET` to the `Env` interface.
- [ ] Move `chaodaysClient` construction from module scope into the `fetch`
      handler (it now depends on `env`, like `pushSender`). Build it with
      `{ baseUrl: env.CHAODAYS_RELAY_BASE, relaySecret: env.CHAODAYS_RELAY_SECRET }`
      when `CHAODAYS_RELAY_BASE` is set; otherwise `new HttpChaodaysClient()`
      (direct). Keep the existing DI into `createApp` unchanged.
- [ ] `.dev.vars.example`: document the two new optional vars with a one-line
      comment (relay base is non-secret; the secret is set via `wrangler secret
      put` in deployed environments).

## 3. Relay config deliverable (non-Pulumi)

- [ ] `relay/Caddyfile`: a `<ip-dashed>.nip.io` site block with automatic
      Let's Encrypt; a named matcher on `header X-Relay-Secret <secret>` whose
      `handle @authed` `reverse_proxy https://api.chaodays.app` with `header_up
      Host api.chaodays.app` **and `header_up -X-Relay-Secret`** (strip the secret
      so it never forwards to the third party); an unauthenticated fallback
      `handle { respond 403 }` (a block, not a bare `respond 403`, so directive
      ordering can't 403 authed requests). Use clearly-marked placeholders for the
      host and secret.
- [ ] `relay/README.md`: one-time manual setup on the existing Lightsail box —
      attach a **static IP**, open firewall ports 80 + 443, install Caddy, drop in
      the Caddyfile with the real `nip.io` host and a generated secret, reload
      Caddy. Plus: set the two Worker secrets/vars (`CHAODAYS_RELAY_BASE`,
      `CHAODAYS_RELAY_SECRET`) via GitHub (Model A: GitHub is the single source of
      truth, CD uploads them with wrangler). Note the static-IP caveat (the nip.io
      host + cert are bound to the IP).

## 4. Gate

- [ ] `npm test` and `npm run typecheck` are green (existing chaodays and import
      tests unchanged; new client tests pass).
