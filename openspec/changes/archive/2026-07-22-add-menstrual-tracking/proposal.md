## Why

The app is adding a menstrual-cycle tracker alongside diet, hydration, bowel,
vitals, and exercise: users record each menstrual period (a start date, and an
end date once it finishes) so the app can report simple cycle statistics and
predict the next period. This is the backend half — persistence and an
authenticated HTTP API for the frontend (a separate life-os change) to consume.
Its motivating value (per the chaodays research) is interpreting weight
fluctuations against the cycle, which the goals/dashboard change (feature C) will
later overlay; this change delivers the raw records plus the derived statistics.

Unlike the day-keyed trackers (water/bowel/vitals) and the day's entry list
(exercise), a menstrual record is a **date range** (start → optional end), and a
user holds a list of them across time. Records are added, edited (typically to
fill in the end date when a period finishes), and deleted.

## What Changes

- **New `menstrual_period` store**: one row per period, holding `start_date`
  (required) and `end_date` (nullable — set when the period ends), keyed by user.
- **Derived statistics, computed on read** (not stored): `average_cycle_days`
  (the mean gap between consecutive start dates, over the most recent periods;
  needs ≥2 periods), `average_period_days` (the mean length of completed periods,
  `end − start + 1`; needs ≥1 completed period), and `predicted_next_start`
  (the last start plus the average cycle length). Each is null when there is not
  enough data.
- **`/api/menstrual` endpoints** (all authenticated):
  - `GET /api/menstrual` → `{ periods: [{id, start_date, end_date}], stats:
    {average_cycle_days, average_period_days, predicted_next_start}, last_period }`
    (periods ordered by start date; `last_period` is the most recent, or null).
  - `POST /api/menstrual` `{ start_date, end_date? }` → the created period.
  - `PATCH /api/menstrual/:id` `{ start_date?, end_date? }` → updates the period
    if owned by the caller; returns the updated period, or a not-found result.
  - `DELETE /api/menstrual/:id` → deletes the period if owned; returns whether one
    was deleted.
- A `MenstrualRepository` port, its use cases (`getMenstrualOverview`,
  `addPeriod`, `updatePeriod`, `deletePeriod`), a Drizzle adapter, a schema
  migration, and route/wiring in `app.ts` + `index.ts`, following the existing
  health-context patterns. Writing rejects a missing/invalid `start_date`, or an
  `end_date` earlier than `start_date`, with 400 (via `BadRequestError`, so the
  Hono `onError` maps it to 400 rather than 500). No change to existing code
  beyond additive wiring.

## Capabilities

### Added Capabilities

- `menstrual-tracking`: persist a per-user list of menstrual periods (a start
  date and an optional end date each), derive simple cycle statistics (average
  cycle length, average period length, predicted next start) on read, and expose
  them over an authenticated `/api/menstrual` API for reading the overview,
  adding a period, editing a period, and deleting a period. Records and
  statistics only — no overlap validation and no ovulation/fertility prediction
  in this version.
