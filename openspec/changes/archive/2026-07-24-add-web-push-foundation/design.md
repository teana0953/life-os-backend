# Design — Web Push foundation + test push

## Context & scope

This is Slice 1a of the reminders feature. It delivers the **transport** only:
subscription storage + a Web Push sender + a manual test-push trigger. Reminder
scheduling (Cron, `reminder_occurrence`, medication/rehab/glucose/missed-meal) is
explicitly out of scope and lands in later slices. The whole point of shipping the
transport alone first is to **de-risk iOS/Android PWA push delivery** before
building logic on top of it.

## Architecture

New bounded context `src/contexts/notifications/`, following the repo's
context-first Clean Architecture (copy the `user`/`health` layout):

```
domain/
  push-subscription.ts          # PushSubscription entity + PushSubscriptionRepository port
  push-sender.ts                # PushMessage value + PushSender port + PushSendResult
application/
  subscribe-web-push.ts         # upsert a subscription for a user
  unsubscribe-web-push.ts       # remove a subscription by endpoint (idempotent)
  send-test-push.ts             # send a fixed test message to all the user's subs
adapters/
  drizzle-push-subscription-repository.ts
  web-push-sender.ts            # WebPushSender implements PushSender (WebCrypto/VAPID)
```

Wiring: `src/adapters/http/routes/push.ts` (route factories), `CreateAppOptions`
gains `pushSubscriptionRepository`, `pushSender`, `vapidPublicKey`; `index.ts`
constructs `DrizzlePushSubscriptionRepository(getDb)` and
`new WebPushSender({ publicKey, privateKey, subject })` from env.

## Key decisions

- **D1 — Standard Web Push (VAPID), not Firebase/FCM.** The browser subscribes to
  its own push service; the backend signs with its own VAPID key pair. Free, no
  Apple Developer account, no SDK. `PushSender` is a port so the crypto/HTTP is
  isolated behind an interface and use cases stay testable with a fake.

- **D2 — `PushSendResult = "sent" | "expired" | "failed"`.** The push service
  returns 201/200 on success, **404/410** when the subscription is permanently gone
  (browser cleared it), and other 4xx/5xx / network errors otherwise. Only
  `expired` triggers deletion of the stored subscription (a transient `failed`
  must not drop a still-valid subscription). `sendTestPush` counts `sent` vs
  `failed` (expired counts as failed for the summary) and deletes expired ones.

- **D3 — `WebPushSender` runs on WebCrypto, not Node `crypto`.** It must work in
  `workerd`. Implement RFC8291 (ECDH P-256 → HKDF → AES-128-GCM, `aes128gcm`
  content-encoding) and RFC8292 (VAPID JWT signed ES256, `Authorization: vapid
  t=<jwt>, k=<pubkey>`), plus the `TTL` header. Prefer a small, audited
  Workers-compatible implementation vendored/added as a dependency over a bespoke
  one; whichever is chosen **must import and typecheck under the `workers` vitest
  project**. If a dependency is added, pin an exact version.

- **D4 — What 1a's gate does and does NOT prove.** `npm test` uses a **fake
  `PushSender`** for the use cases and a **fake `fetch`** for the `WebPushSender`
  adapter (asserting the HTTP contract: correct `endpoint`, `POST`, `TTL` header,
  an `Authorization: vapid …` header, a non-empty encrypted body, and 404/410 →
  `expired`). It intentionally does **not** assert ciphertext correctness — that is
  only truly verifiable when a real browser/push service decrypts it, which is the
  on-device success criterion of Slice 1b. This split is deliberate: 1a lands
  reviewable, typed, contract-tested code; 1b proves real delivery.

- **D5 — `push_subscription` uniqueness = `endpoint`.** A push endpoint is globally
  unique to a browser/subscription, so `subscribe` upserts on conflict(`endpoint`),
  updating `user_id` + keys. This also handles a device being reassigned to a
  different lifeos user (the browser issues a fresh endpoint on re-subscribe, and
  even if not, the row is reassigned rather than duplicated).

- **D6 — Env vars, safe when unset.** `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
  `VAPID_SUBJECT` are optional on `Env` so existing deploys don't break before the
  secrets are set. `GET /api/push/vapid-public-key` returns whatever is configured
  (empty string if unset); `WebPushSender` returns `failed` (never throws a 500)
  when keys are missing. Only the push routes depend on them.

## Privacy / security

- **`endpoint` must be an `https://` URL.** `POST /api/push/test` fetches the stored
  `endpoint`, so it is an authenticated request-forwarding surface aimed at a
  user-supplied URL. Push endpoints are legitimately arbitrary hosts (no allowlist
  possible), but `subscribe` SHALL reject a non-`https` / non-URL `endpoint` with
  400, closing the `http://`/other-scheme SSRF vector and rejecting garbage early.
- The subscription `endpoint`, `p256dh`, and `auth` are user-sensitive and are
  **never written to logs** (no `console.log` of subscriptions; the generic
  `console.error(err)` boundary must not receive them).
- The test push payload is a **fixed generic string** (e.g. title "LifeOS 測試通知")
  with no personal data.
- `VAPID_PRIVATE_KEY` is a secret (never committed; `wrangler secret put`).

## Testing

- **Unit (`test/contexts/notifications/application/*`)**: `subscribeWebPush`,
  `unsubscribeWebPush`, `sendTestPush` against an in-memory
  `PushSubscriptionRepository` + a fake `PushSender` (scriptable to return
  `sent`/`expired`/`failed`): upsert idempotency, idempotent delete, and that
  `sendTestPush` sums sent/failed and deletes only `expired` subscriptions.
- **Adapter (`test/adapters/notifications/web-push-sender.test.ts` — placed under
  `test/adapters/**` so it runs in the `workers` vitest project, i.e. actually
  under `workerd`, not plain Node)**: inject a fake `fetch` and assert the HTTP
  contract of D4; 404/410 → `expired`, other non-2xx → `failed`. Running it in
  `workerd` proves the sender's real `crypto.subtle` path (ECDH/HKDF/ES256) loads
  and executes in the Workers runtime — closing the gap that a `test/contexts/**`
  (Node) location would leave (compile-time only). Ciphertext bytes are still not
  asserted (proven on-device in 1b).
- **Route (`test/adapters/http/push.test.ts`, workers project)**: 401 without a
  lifeos token; 200/204 subscribe + idempotent re-subscribe; 400 on missing
  `endpoint`/`p256dh`/`auth`; idempotent unsubscribe; `GET vapid-public-key`
  returns the configured key; `POST test` returns `{ sent, failed }` and prunes
  expired subscriptions — all with injected fakes, no real infrastructure.
