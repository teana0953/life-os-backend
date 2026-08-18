## Why

The backend cannot tell a reminder that was delivered from one that was not.
`WebPushSender` treats the push service's 2xx as `outcome: "sent"`, and every
`care_occurrence` row in production carries `last_send_outcome = sent` with an
empty `last_send_detail` — including on days the user reports receiving
nothing. Those two facts do not contradict each other: a 201 means the push
service accepted the message, and says nothing about a device.

Two concrete defects sit underneath that:

1. **TTL 60 seconds, hardcoded** (`web-push-sender.ts`). RFC 8030 §5.2: "Once
   the TTL period elapses, the push service MUST NOT attempt to deliver the
   push message." A phone that is off the network for 61 seconds when a
   reminder fires never receives it, and nothing anywhere records that.
2. **No delivery evidence at all.** RFC 8030 §5.1/§6.3 does define receipts,
   and §7.4 names the alternative when they are unavailable — "forces the
   device to acknowledge receipt directly to the application server". Receipts
   are not available to us: they require the push service to implement them and
   the application server to hold an HTTP/2 stream open to receive server
   pushes, which a Cloudflare Worker `fetch` cannot do. Measured on 2026-08-18
   against a real FCM endpoint from this project's own subscriptions: a POST
   carrying `Prefer: respond-async` returned **201** (not the 202 §5.1
   specifies for an accepted receipt request) with **no**
   `Link: rel="urn:ietf:params:push:receipt"` header.

## What Changes

- **`PushMessage.ttlSeconds` becomes required**, and `urgency` optional. The
  adapter sends the caller's TTL verbatim and emits `Urgency` only when set
  (RFC 8030 §5.3: an absent header already means `normal`). Each caller states
  its own number: a nagging care slot uses its nag interval, a fire-once slot
  uses `FIRST_FIRE_GRACE_MINUTES`, the test push keeps 60, a budget alert uses
  a day.
- **New `push_delivery` table**: one row per (occurrence x subscription)
  attempted send, written before the send,
  holding `sha256` of a one-time ack token, `sent_at`, `expires_at`, and a
  nullable `acked_at`.
- **New `POST /api/push/ack`**, the only route under `/api/` without
  `authMiddleware`. A service worker echoes the one-time token that arrived
  inside its encrypted payload; the endpoint answers 204 for every input.
- Care reminders now carry `data.ack`. Test pushes and budget alerts do not.

## Non-goals

- **Nothing changes behaviour.** An ack does not stop a nag, does not
  reschedule, does not touch `care_occurrence`. "This device received the
  message" is not "the user took the medication"; `care_log` remains the only
  thing that ends a nag. Letting an ack silence a reminder would also make
  silencing a medication reminder an unauthenticated capability.
- No read API for delivery state (query `push_delivery` directly, as with
  `last_send_detail` today).
- No retention/cleanup job.
- No frontend work: `life-os`'s `web/push_sw.js` is a separate change, and
  **until it ships nothing in production will ever be acked.**

## Status

Backend only. This change does not fix, and must not be described as fixing,
the 2026-08-18 "no notification arrived" report — the absence of delivery
evidence is exactly why that cause cannot be established. It fixes two known
reliability defects and creates the evidence that a future report can be
settled with.
