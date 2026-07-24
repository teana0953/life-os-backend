# Tasks

## 1. Domain: notifications ports
- [ ] `contexts/notifications/domain/push-subscription.ts`: `PushSubscription
      { userId, endpoint, p256dh, auth }` and `PushSubscriptionRepository` port —
      `upsert(sub)` (by endpoint), `listByUser(userId)`, `deleteByEndpoint(userId,
      endpoint)`.
- [ ] `contexts/notifications/domain/push-sender.ts`: `PushMessage { title, body,
      data? }`, `PushSendResult = "sent" | "expired" | "failed"`, and `PushSender`
      port — `send(subscription, message): Promise<PushSendResult>`.

## 2. Use cases (TDD, in-memory repo + fake sender)
- [ ] Test `subscribeWebPush`: stores a subscription; re-subscribing the same
      endpoint upserts (no duplicate; keys/userId updated).
- [ ] Test `unsubscribeWebPush`: removes by endpoint; removing a non-existent
      endpoint is a silent no-op.
- [ ] Test `sendTestPush`: sends to every subscription of the user; returns
      `{ sent, failed }` counts; a subscription the sender reports `expired` is
      deleted (and counts as failed), a `failed` one is NOT deleted.
- [ ] Implement `application/subscribe-web-push.ts`,
      `application/unsubscribe-web-push.ts`, `application/send-test-push.ts` to pass.

## 3. Schema + Drizzle repository (TDD)
- [ ] `shared/db/schema.ts`: `push_subscription` table — `id` uuid pk, `user_id`
      uuid → users, `endpoint` text notNull **unique**, `p256dh` text notNull,
      `auth` text notNull, `created_at` timestamptz default now.
- [ ] `contexts/notifications/adapters/drizzle-push-subscription-repository.ts`
      implementing the port; `upsert` uses `onConflictDoUpdate` on `endpoint`.
      (Follow the existing `Drizzle*Repository` pattern with the injected `getDb`.)

## 4. Adapter: WebPushSender (TDD, injected fetch)
- [ ] Test **at `test/adapters/notifications/web-push-sender.test.ts`** (so it runs
      in the `workers` vitest project = real `workerd`, not the Node `unit`
      project; this actually exercises the WebCrypto path). Inject a fake `fetch`:
      `send` POSTs to `subscription.endpoint` with a
      `TTL` header and an `Authorization: vapid …` header and a non-empty body →
      `sent` on 201/200; **404/410 → `expired`**; other non-2xx / throw → `failed`;
      missing VAPID keys → `failed` (never throws). Do NOT assert ciphertext bytes
      (that is proven on-device in Slice 1b, per design D4).
- [ ] `contexts/notifications/adapters/web-push-sender.ts`: RFC8291 (`aes128gcm`)
      + RFC8292 (VAPID ES256) via **WebCrypto** (runs in `workerd`, no Node
      `crypto`). Constructor `{ publicKey, privateKey, subject, fetchImpl? }`.
      Prefer a small Workers-compatible library (pinned exact version) over a
      bespoke implementation; it MUST import/typecheck under the `workers` project.
      Never log the subscription or its keys.

## 5. Routes + wiring (TDD, integration via createApp)
- [ ] Route test `test/adapters/http/push.test.ts` (workers project, injected
      fakes): 401 without lifeos token; `POST /api/push/subscribe` upserts (200/204)
      and is idempotent on the same endpoint; 400 when `endpoint`/`p256dh`/`auth`
      missing **or when `endpoint` is not an `https://` URL**; `DELETE
      /api/push/subscribe` idempotent; `GET
      /api/push/vapid-public-key` returns `{ public_key }`; `POST /api/push/test`
      returns `{ sent, failed }` and prunes `expired` subscriptions.
- [ ] `routes/push.ts`: the four handler factories (`resolveUserId`,
      `requireString` for body validation, snake_case boundary). Validate that
      `endpoint` parses as an `https://` URL (400 otherwise) — add a small
      `requireHttpsUrl(value, field)` helper to `validation.ts` (throws
      `BadRequestError`) rather than inlining.
- [ ] `app.ts`: add `pushSubscriptionRepository`, `pushSender`, `vapidPublicKey`
      to `CreateAppOptions`; register the four routes under `authMiddleware`.
- [ ] `index.ts`: add `VAPID_PUBLIC_KEY?`, `VAPID_PRIVATE_KEY?`, `VAPID_SUBJECT?`
      to `Env`; construct `DrizzlePushSubscriptionRepository(getDb)` and
      `new WebPushSender({...})`; pass them + `vapidPublicKey` into `createApp`.

## 6. Config docs
- [ ] `.dev.vars.example`: add `VAPID_PUBLIC_KEY=`, `VAPID_PRIVATE_KEY=`,
      `VAPID_SUBJECT=mailto:you@example.com` with a one-line note that the private
      key is a secret (`wrangler secret put`).

## 7. Gate
- [ ] `npm test` + `npm run typecheck` green.
