## Why

The dashboard's next card is a **health-metrics trend chart** (feature C2): the
user asked for weight and body fat **plus blood pressure, heart rate, blood
oxygen, and blood glucose** over time. The vitals tracker already stores all of
this per day (weight/body-fat scalars and blood-pressure / glucose / blood-oxygen
reading arrays), but only exposes a single day at a time. This change adds a
**range query** that returns each metric as a time series the frontend chart can
plot. Backend only; the chart UI is a separate life-os change.

## What Changes

- **Additive vitals read**: `VitalsRepository.listRange(userId, from, to)` — the
  user's vitals records whose day falls in `[from, to]`, ascending. No change to
  existing vitals behaviour.
- **Per-metric daily series, derived on read** (a pure helper): each metric
  becomes a list of `{ day, value }` points, one point per day that has a value
  for that metric —
  - `weight` = the day's `weight_kg`; `body_fat` = the day's `body_fat_pct`
    (scalars, 1 decimal),
  - `systolic` / `diastolic` = the daily mean of the blood-pressure readings,
  - `pulse` = the daily mean of every recorded pulse (across blood-pressure and
    blood-oxygen readings),
  - `glucose` = the daily mean of the glucose readings,
  - `spo2` = the daily mean of the blood-oxygen readings
    (blood-pressure/pulse/glucose/spo2 rounded to whole numbers).
  A day with no value for a metric contributes no point to that metric's series.
- **`GET /api/vitals/range?from=&to=`** (authenticated) → `{ from, to, series:
  { weight, body_fat, systolic, diastolic, pulse, glucose, spo2 } }`, each series
  a list of `{ day, value }`. Rejects a missing/invalid `from`/`to`, or a `from`
  later than `to`, with 400.
- The use case, the pure series helper, the route, and wiring (reusing the
  existing `vitalsRepository`), following the health-context patterns. Only one new
  repository method (`listRange`) is added; every fake `VitalsRepository` in the
  tests gets it so typecheck stays green. No schema change, no migration, and no
  new `CreateAppOptions` field.

## Capabilities

### Added Capabilities

- `vitals-trends`: expose the user's vitals over a date range as per-metric daily
  time series (weight, body fat, systolic, diastolic, pulse, glucose, blood
  oxygen) over an authenticated `/api/vitals/range` API, aggregating each day's
  readings to a daily mean. Series only — no smoothing, banding (min/max), or
  per-reading resolution in this version.
