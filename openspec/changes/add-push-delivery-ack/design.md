# Design — Push delivery receipts (client ack) + per-message TTL/Urgency

## Context & scope

The application server has no way to distinguish "the push service took it"
from "a device got it", and holds every message for only 60 seconds. This
change fixes the second directly and makes the first *measurable* — it does not
make delivery more likely by itself beyond the TTL change.

### Measured, not assumed

RFC 8030 does specify receipts (§5.1 request via `Prefer: respond-async`,
§6.3 delivery via HTTP/2 server push on a long-lived GET). Two things rule them
out here, and only the first was verified by hand:

- **FCM does not offer them.** 2026-08-18, one request to a real subscription
  endpoint from this project's `push_subscription` table, with
  `Prefer: respond-async` added to the otherwise-normal send: response
  **201**, headers `location`, `alt-svc`, `content-length: 0`, `date`, and
  Google's usual security headers — no `Link` receipt relation. §5.1 requires
  **202** when a receipt request is accepted.
- **Workers cannot receive them.** §6.3 delivers receipts as HTTP/2 server
  pushes on a request the application server keeps outstanding. The Workers
  runtime's `fetch` neither stays resident nor exposes server push.

§7.4 names the fallback in as many words: lacking reliable delivery "forces the
device to acknowledge receipt directly to the application server". That is what
this change implements.

## Key decisions

### D1 — The ack credential is a one-time token carried inside the encrypted payload

A service worker handling a `push` event while the app is closed has no
Firebase ID token; that is not an obstacle to work around but the exact
situation delivery data has to cover. The only secret such a worker holds that
is bound to *this* message is the payload itself, and the payload is RFC 8291
end-to-end encrypted to the subscription's own key: being able to read the
token already means being the device.

- 32 random bytes, base64url (43 chars), minted per (occurrence x
  subscription) — two devices necessarily get different tokens.
- The database stores **only `sha256(token)`**. A leaked backup, or a row
  pasted into a diagnostic, must not yield a usable capability.
- Sent in the **request body**, not in the URL. A capability URL
  (`/api/push/ack/<token>`) would be copied into Cloudflare's request logs, any
  intermediary's access log, and browser history by construction — the exact
  class of leak PR #107 just finished closing.
- The route logs nothing at all, not even on error.

**What happens when it is hammered:**

| attack | result |
| --- | --- |
| guessing tokens | 256 bits; and the response is 204 whether or not a row matched, so there is no oracle to guess against |
| holding a real token (i.e. already controlling that device) | one row's `acked_at` gets set. Nothing else: by D3 an ack changes no behaviour, so "silence my reminders" is not among the capabilities |
| replaying an old token | `acked_at IS NULL AND expires_at > now()` in the `UPDATE` rejects it; even if it did not, see the row above |
| flooding to burn Neon compute | the real risk, and it is operational, not confidentiality. Code-side: a shape check (`^[A-Za-z0-9_-]{43}$`) runs before any query so junk costs zero DB work, a body whose `Content-Length` declares more than 1 KB is discarded before it is even read (and one that under-declares is discarded after buffering, before parsing), and a hit is one `UPDATE` with no preceding `SELECT`. Beyond that the lever is Cloudflare WAF rate limiting, not application code |
| CSRF / cross-site POST | the route reads no cookie and no `Authorization`, so a cross-site caller gains nothing it did not already have |

**Rejected:** asking an open tab for a token via `clients.matchAll()` (fails
precisely when the app is closed, which is the case being measured);
stateless HMAC tokens (saves the insert but still needs a row written on ack,
adds key management, loses revocability); using the subscription `endpoint` as
identity (it *is* a credential, and it cannot say *which message*).

### D2 — Payload gains exactly one field

`{title, body, data: {ack}}`. `PushMessage.data` already existed and had never
been populated by any caller. No occurrence id: the token already determines
the row server-side, so an occurrence id would be a field nobody reads — and in
this project a field the client does not read is the field the next save
deletes.

Size: RFC 8030 §7.2 guarantees only that a push service will not 413 an entity
body of 4096 bytes or less. Against the `aes128gcm` framing (16 salt + 4 record
size + 1 key length + 65 public key = 86 bytes of header, plus a 1-byte record
delimiter and a 16-byte GCM tag) that leaves **3993 bytes of plaintext**.
Current messages are ~50 bytes; the token adds ~60.

`ttlSeconds`/`urgency` are deliberately **not** in the payload — they are
instructions to the push service, and the adapter serializes only
`title`/`body`/`data`.

### D3 — An ack records a fact and changes nothing

No nag is stopped, no `nextDueAt` is touched, no escalation is introduced,
`run-care-day.ts`'s dispatch decisions are untouched apart from registering the
rows. Reasons, in order of weight: the ack means "the device received it", not
"the user complied", and `care_log` already carries the latter; and the ack
endpoint is unauthenticated, so any behaviour it drives becomes an
unauthenticated capability.

This is also what preserves the TTL argument in D5: because acking feeds into
no dispatch decision, nag timing is bit-for-bit what it was, so "TTL <= nag
interval implies at most one live copy per slot" still holds. If a later change
lets an ack gate a nag, that invariant has to be re-derived.

### D4 — A new table, first ack wins

```
push_delivery(id, care_occurrence_id, push_subscription_id,
              token_hash UNIQUE, sent_at, expires_at, acked_at NULL)
```

Not columns on `care_occurrence`: payloads are encrypted per subscription, so N
devices means N different tokens, which one column cannot hold — and "which
device received it" is most of the diagnostic value.

Occurrence-level delivery is `EXISTS (... AND acked_at IS NOT NULL)` — any one
device's ack counts. That matches `summarizeOutcome`'s existing D10 rule
("partial success counts as delivered — the user already got it"), so the two
cannot give contradictory answers.

Deliberately absent: a per-device send outcome (aggregate already lives on
`care_occurrence`; per-device failure attribution is out of scope) and any
retention job.

`expires_at = sent_at + ttlSeconds`, with no grace. A very slow service worker
is therefore recorded as un-acked. That direction is chosen on purpose: better
to under-report delivery than to ever record one that could not have happened.

`care_occurrence_id` cascades; `push_subscription_id` is **nullable with `ON
DELETE SET NULL`**. Pruning a 404/410 subscription — which `dispatchSlot`,
`send-test-push`, the budget-alert notifier and the user-facing
`unsubscribe-web-push` all do — is exactly the moment PR #107's incident
produces (a reinstalled PWA going dark), so a cascade would delete the
never-acked rows that are the evidence of it. After SET NULL the row keeps
`care_occurrence_id` (the anchor both diagnostic queries filter on), `sent_at`,
`expires_at` and `acked_at`; the count per occurrence still equals the device
count at send time. What is lost is only telling two now-deleted devices apart,
and cross-round correlation of a pruned device — the join to `push_subscription`
is dead under every option, since the parent row is gone.

Rejected:

- **Cascade (the original choice)** — self-defeating: the evidence disappears
  at the exact moment that created the question.
- **Keep `NOT NULL`, no delete rule** — the FK violation escapes `dispatchSlot`
  outside its `try`, is swallowed by the per-schedule `catch`, and
  `recordAttempt` never runs (the occurrence looks like an abandoned claim,
  next retry >= 10 min); and unsubscribe 500s for any user who ever got a
  reminder.
- **Drop the FK, keep a bare uuid** — buys nothing over SET NULL (joins are
  dead either way) and gives up referential integrity on the live path.
- **Store `endpoint_hash` instead** — the only option preserving dead-device
  identity, but it needs a new column plus a hash on the send hot path, and
  `push_subscription.id` is already stable across re-subscribe from the same
  browser (upsert on `endpoint`), so the hash is no more stable, only more
  durable. Recorded as the follow-up if per-dead-device attribution ever
  becomes a real operational need.
- **Soft-delete `push_subscription`** — largest blast radius, smallest gain:
  `endpoint` is UNIQUE so a re-subscribe collides with the tombstone, and one
  forgotten `deleted_at` filter means pushing to a 410 endpoint forever, a new
  instance of the failure class this change exists to fix.

### D5 — TTL per message, Urgency only when chosen

`ttlSeconds` is required on `PushMessage` rather than defaulted, so no number
exists that nobody can account for.

| caller | TTL | why |
| --- | --- | --- |
| care slot with a nag | `nagIntervalMinutes x 60` | the next nag *replaces* this message; TTL <= the interval gives "at most one live copy per slot" |
| care slot, nag = 0 | `FIRST_FIRE_GRACE_MINUTES x 60` = 600 | fires once, so the ceiling is "how late is still useful" — a number this repo already fixed at 10 minutes (gate_decision #2) |
| test push | 60 | means "I pressed the button, does my phone light up now" |
| budget alert | 86400 | a budget is month-shaped; same-day is still actionable, longer is pointless |

Care reminders and the test push send `Urgency: high`. The only support for
that is RFC 8030 §5.3's own table, whose `high` row is exemplified by "incoming
call or alert" for a device in a low-battery state. **No claim is made about
FCM high-priority or Android Doze** — no authoritative source for either was
found. Budget alerts send no `Urgency` at all; absent is not the same wire
message as `normal`.

### D6 — Test pushes and budget alerts are not acked

Neither has an occurrence to attribute delivery to; giving them one would mean
a nullable `care_occurrence_id` plus a `kind` discriminator for two callers
that do not need it. The test push already answers synchronously with per-
subscription results, and the user is standing in front of the device.

**Consequence for the frontend, and the seam most likely to be missed:** the
service worker MUST tolerate a payload whose `data` carries no `ack` and simply
not post one. Otherwise the test push breaks inside the service worker.

## Frontend hand-off contract (`life-os`, `web/push_sw.js` — not in this change)

1. **Endpoint**: `POST https://<api>/api/push/ack`, body `{"ack": "<43-char
   base64url>"}`, sent with **`Content-Type: text/plain`** — not
   `application/json`, and not by accident. `text/plain` is a CORS-safelisted
   value (Fetch Standard §2.2.2), so the POST stays a *simple* request and no
   preflight is sent. By those rules plus the allowlist this API actually
   configures — `isAllowedOrigin` in `src/adapters/http/app.ts` admits only
   localhost/127.0.0.1 plus the single configured `ALLOWED_WEB_ORIGIN`, and
   hono's `cors` emits `Access-Control-Allow-Origin` only for an admitted
   origin, so every Cloudflare Pages **preview** deployment is a disallowed
   origin — an `application/json` POST from such an origin is preflighted, the
   preflight comes back `204` with no `Access-Control-Allow-Origin`, and **the
   POST never leaves the browser**; the safelisted one still reaches the handler and
   only its response is withheld from the page, which costs nothing because
   that response is always an empty `204`. The bytes on the wire are unchanged:
   the body is still JSON, and `src/adapters/http/routes/push-ack.ts` reads
   `c.req.text()` and `JSON.parse`s it **without ever consulting
   `Content-Type`**. So do **not** "correct" this back to `application/json`
   for consistency with the body — it type-checks, it tests green, and it
   silently kills the ack on every preview origin. Send **no** `Authorization`
   header (D1); it is not safelisted either, so adding one brings the preflight
   back. The response is always `204` with an empty body; there is nothing to
   branch on.
2. **In the `push` handler**: the token sits **one level in**. The wire payload
   is `{title, body, data: {ack}}` (D2) and `event.data.json()` returns that
   *whole* object, so with `var payload = event.data.json()` the token is
   **`payload.data.ack`**, never `payload.ack`. (Backend evidence:
   `web-push-sender.ts` serializes
   `{title: message.title, body: message.body, data: message.data}`, and
   `run-care-day.ts` passes `data: { ack: ackToken }`.) Read one level too
   high it is `undefined` for every push, so the ack silently never fires —
   and a test whose fixture is built to the same wrong shape stays green, so
   only a run against a real payload catches it. Post the ack with the `fetch`
   wrapped in `event.waitUntil(...)`, or the worker may be killed before the
   request leaves. **Show the notification first, ack second** — a failed ack
   must never cost the user the notification.
3. **State while only the backend has shipped**: every `push_delivery` row has
   `acked_at = NULL`. In that window **"not acked" means "nobody reported",
   not "not delivered"** — this sentence belongs in any query, dashboard, or
   report built on this table before the service worker exists.
4. **Acceptance**: on a real device, receive one reminder and observe at least
   one `push_delivery` row for that occurrence with `acked_at IS NOT NULL`.
   Until that has happened, this feature is described as "backend ready,
   end-to-end unverified" — never as done.

## What only a real device can show

The automated suite proves what headers and bytes this server emits, and what
the ack SQL accepts or refuses. It cannot prove:

- that a service worker can issue the ack `fetch` at all in a `push` event, or
  how long `event.waitUntil` really keeps it alive;
- whether an ack still goes out with the screen off or under battery saver;
- whether FCM honours the TTL and Urgency we send — only that we send them;
- iOS PWA service worker behaviour;
- and none of the above is even reachable until `web/push_sw.js` ships.
