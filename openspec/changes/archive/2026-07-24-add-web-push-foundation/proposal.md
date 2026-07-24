## Why

First slice of the reminders/notifications feature (medication, rehab, post-meal
glucose, missed-meal). Every reminder type ultimately needs one capability: deliver
a notification to the user's device while the app is closed. On a PWA that means
**standard Web Push (VAPID)** — no Firebase, no Apple Developer account, no
per-message cost. This slice builds only that delivery foundation plus a manual
**"send a test push now"** path, so the riskiest unknown — whether an installed
iOS/Android PWA actually receives a push — can be proven end-to-end (on-device, in
the frontend slice) before any reminder scheduling is built on top of it.

## What Changes

- **New `notifications` context.** `PushSubscription { userId, endpoint, p256dh,
  auth }` entity + `PushSubscriptionRepository` port (upsert by endpoint,
  list-by-user, delete-by-endpoint), and a `PushSender` port
  (`send(subscription, message)` → `sent | expired | failed`; `expired` = the push
  service reported the subscription gone).
- **`push_subscription` table** (Drizzle/Neon): `user_id`, `endpoint` (unique),
  `p256dh`, `auth`, `created_at`. Re-subscribing the same endpoint upserts.
- **`WebPushSender`** driven adapter: sends a Web Push message per RFC8291
  (aes128gcm payload encryption) + RFC8292 (VAPID `Authorization` JWT, ES256),
  built on WebCrypto so it runs in the Workers runtime (no Node `crypto`). A
  404/410 from the push service maps to `expired`.
- **Use cases**: `subscribeWebPush`, `unsubscribeWebPush`, and `sendTestPush`
  (list the user's subscriptions, send a fixed generic test message to each, delete
  any that come back `expired`, return `{ sent, failed }`).
- **Routes** (authenticated lifeos user, snake_case boundary):
  `GET /api/push/vapid-public-key` → `{ public_key }`;
  `POST /api/push/subscribe` `{ endpoint, p256dh, auth }` → upsert;
  `DELETE /api/push/subscribe` `{ endpoint }` → idempotent remove;
  `POST /api/push/test` → `{ sent, failed }`.
- **Config**: three new Workers env vars — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` (e.g. `mailto:`) — documented in `.dev.vars.example`. The public
  key is non-secret; the private key is a secret set via `wrangler secret put`.

Backend only. **No** Cron scheduler, **no** reminder types (medication / rehab /
glucose / missed-meal — later slices), **no** `reminder_occurrence` table, **no**
frontend (the service worker + subscribe UI + test-push button are the next slice).
The subscription's `endpoint`/`p256dh`/`auth` are user-sensitive and are never
logged; the test push carries a fixed generic string, no personal data. Gate =
`npm test` + `npm run typecheck`.

## Capabilities

### Added Capabilities

- `web-push`: an authenticated lifeos user can register, replace, and remove a Web
  Push subscription for their device, fetch the VAPID public key needed to
  subscribe, and trigger a test push to all their subscriptions — the shared
  delivery foundation every reminder type will build on.
