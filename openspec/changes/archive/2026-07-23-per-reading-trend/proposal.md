## Why

The vitals trend collapses each day's readings into a single daily mean, so two
blood-pressure checks (or a fasting vs. post-meal glucose) on the same day become
one averaged dot. Users want to see **every reading**, at the time it was taken —
so a spike or a fasting/post-meal difference is visible rather than averaged away.
This changes the trend series from daily means to **one point per reading**.

## What Changes

- **`buildVitalsSeries` — per reading, not per day**: for the reading-based metrics
  (systolic, diastolic, pulse, glucose, blood oxygen) the series now carries **one
  point per reading**, each with the reading's `time` (`HH:mm`), instead of the
  day's mean. Pulse still draws from every recorded pulse across blood-pressure and
  blood-oxygen readings. Scalars (weight, body fat) stay one point per recorded day
  (with an empty `time`). Every point gains a `time` field and each series is
  ordered by day then time.
- **Glucose points carry meal context**: each glucose point is
  `{ day, time, value, mealContext }`. The four daily-mean glucose context
  sub-series added in the previous change (`glucose_fasting` / `glucose_pre_meal` /
  `glucose_post_meal` / `glucose_unspecified`) are **removed** — the per-reading
  points carry their own context, so the client can group/colour them directly.
- **`GET /api/vitals/range`**: each series point is `{ day, time, value }` (glucose
  additionally `meal_context`). The four glucose context series are gone.

Backend only; the trend UI is updated separately to plot per-reading points on a
time axis. Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `vitals-trends`: the trend exposes one point per reading (with its time-of-day)
  rather than a daily mean, and glucose points carry their meal context; the
  daily-mean glucose context sub-series are removed.
