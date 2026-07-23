## Why

First slice of "import my data from chaodays". chaodays is the user's existing
self-tracking app; its data lives behind a REST API (devise_token_auth). This
slice pulls the simplest structured data — weight + body fat — to prove out the
cross-service auth + fetch + write-into-lifeos pipeline before the parsing-heavy
slices (diet + glucose) and the rest (water, bowel) reuse the same connector.

## What Changes

- **`ChaodaysClient`** (health-context domain port) + **`HttpChaodaysClient`**
  adapter: `signIn(uid, password)` → chaodays `POST /users/sign_in` returning a
  `{ accessToken, client, uid }` session from the response headers
  (devise_token_auth); `fetchWeightRecords(session, from, to)` → chaodays
  `GET /users/weight_records` returning the day records **and the rotated session**
  (devise rotates `access-token` per response). Two domain error types —
  `ChaodaysAuthError` (bad chaodays credentials) and `ChaodaysUpstreamError`
  (other non-200 / network) — reused by later slices.
- **`importChaodaysWeight`** use case: signs in, fetches the range, and for each
  day does a **read-modify-write** on vitals — `get` the existing day, set only
  `weightKg` / `bodyFatPct`, preserving that day's BP / glucose / spo2 lists (the
  vitals `set` is a whole-day upsert). Returns `{ imported, skipped, from, to }`.
- **`POST /api/import/chaodays/weight`** (authenticated lifeos user): body
  `{ chaodays_uid, chaodays_password, start_date, end_date }` → summary. The
  chaodays password is used once to obtain a token and **never stored** (not in
  the DB, logs, or env); the session token is likewise one-shot.
- **`onError`** gains: `ChaodaysAuthError` → 400 `chaodays_auth_failed`,
  `ChaodaysUpstreamError` → 502 `chaodays_unavailable` (an upstream failure, not a
  lifeos-internal 500).

Backend only, weight + body fat only — no diet/glucose/water/bowel (later slices),
no frontend. No new env/secret (credentials come in the request body; the base URL
is a constant). Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Added Capabilities

- `chaodays-import`: an authenticated lifeos user can import their chaodays weight
  and body-fat history into lifeos vitals by supplying their chaodays credentials
  and a date range, without those credentials being stored.
