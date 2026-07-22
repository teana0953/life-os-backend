## Why

The app is adding a health-metrics (vitals) tracker: users record, per day, their
weight and body fat (once a day), plus three kinds of repeated measurements —
blood-pressure readings (systolic/diastolic with the pulse it was taken with),
blood-glucose readings, and blood-oxygen (SpO₂) readings — each measured several
times a day. This is the backend half — persistence and an authenticated HTTP API
for the frontend (a separate life-os change). It follows the bowel shape (per-day
record, upsert the whole day), extended with three per-day measurement lists.

## What Changes

- **New `vitals` store**: one row per user per day holding `weight_kg`,
  `body_fat_pct` (numeric, nullable — recorded only if measured) and three JSON
  arrays, each defaulting to `[]`:
  - `bp_readings`: `[{ systolic, diastolic, pulse }]` (pulse nullable — heart rate
    lives with the BP reading it was taken with).
  - `glucose_readings`: `[{ label, value }]` (value in mg/dL; label e.g. 餐前/餐後
    or a free word).
  - `spo2_readings`: `[{ spo2, pulse }]` (spo2 in %; pulse nullable).
- **`/api/vitals` endpoints** (all authenticated):
  - `GET /api/vitals?day=` → `{ day, weight_kg, body_fat_pct, bp_readings,
    glucose_readings, spo2_readings }` (an unrecorded day reads both scalars null +
    three empty arrays).
  - `PUT /api/vitals` → upserts the whole day's record (scalars + all three
    arrays) and returns it.
- A `VitalsRepository` port, its use cases (`getVitalsDay`, `setVitalsDay`), a
  Drizzle adapter (jsonb arrays; numeric↔string coercion), a schema migration, and
  route/wiring in `app.ts` + `index.ts`, following the health-context patterns
  (see `bowel-tracking`). No change to existing code beyond additive wiring + the
  required-repo test call sites.

## Capabilities

### Added Capabilities

- `vitals-tracking`: persist a per-user, per-day health-metrics record — weight and
  body fat, plus repeated blood-pressure (systolic/diastolic/pulse), blood-glucose
  (label + mg/dL), and blood-oxygen (SpO₂ + pulse) readings — and expose it over an
  authenticated `/api/vitals` API for reading and upserting the day.
