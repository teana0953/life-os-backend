## Why

The app is adding a bowel-movement tracker alongside diet and hydration: users
record, per day, how many times they went, whether it was normal, and a free-text
note. This is the backend half — persistence and an authenticated HTTP API for the
frontend (a separate life-os change) to consume. It follows the water tracker's
shape but is simpler: no target, no accumulation — a single upsert of the day's
record.

## What Changes

- **New `bowel_log` store**: one row per user per day holding `count` (times,
  ≥0), `is_normal` (nullable boolean — null means not recorded, so an empty day
  is never falsely "normal"), and `note` (free text).
- **`/api/bowel` endpoints** (all authenticated):
  - `GET /api/bowel?day=` → `{ day, count, is_normal, note }` (a day with no
    record reads count 0, is_normal null, note "").
  - `PUT /api/bowel` `{ day, count, is_normal, note }` → upserts the whole day's
    record and returns it.
- A `BowelRepository` port, its use cases (`getBowelDay`, `setBowelDay`), a
  Drizzle adapter, a schema migration, and route/wiring in `app.ts` + `index.ts`,
  following the existing health-context patterns (see `water-tracking`). No change
  to existing code.

## Capabilities

### Added Capabilities

- `bowel-tracking`: persist a per-user, per-day bowel record (count, an optional
  normal/abnormal flag, and a free-text note) and expose it over an authenticated
  `/api/bowel` API for reading and upserting the day's record.
