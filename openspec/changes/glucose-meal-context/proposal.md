## Why

A glucose reading's normal range depends on **when** it was taken — fasting and
pre-meal glucose is normal at ~70–99 mg/dL, but post-meal glucose is normal up to
~140. Today a glucose reading carries only a free-text `label`, and the trend
averages every reading of the day into one point, so fasting and post-meal readings
are conflated and no meaningful reference is possible. This adds a **structured
meal context** to glucose readings and splits the glucose trend by that context, so
the client can plot fasting / pre-meal / post-meal glucose separately (and offer a
correct reference band per context).

## What Changes

- **`GlucoseReading.mealContext`** in the vitals domain: `"fasting" | "pre_meal" |
  "post_meal" | null` (null = unspecified). Stored in the existing
  `glucose_readings` JSONB (additive — legacy readings simply lack the key and read
  back as null; no SQL migration).
- **PUT `/api/vitals`** validation: a glucose reading's `meal_context`, when
  present, MUST be one of `fasting` / `pre_meal` / `post_meal`; any other value is a
  400 (`BadRequestError`, not a silent drop — per the menstrual `end_date` lesson).
  Absent/null is accepted. The reading's snake_case field is `meal_context`.
- **Glucose trend split**: `buildVitalsSeries` keeps the existing `glucose` series
  (the day's mean of **all** glucose readings, unchanged) and **adds** four
  context series — `glucoseFasting`, `glucosePreMeal`, `glucosePostMeal`,
  `glucoseUnspecified` — each the day's mean of that context's readings (unspecified
  = readings with no meal context). `GET /api/vitals/range` returns them as
  `glucose_fasting`, `glucose_pre_meal`, `glucose_post_meal`,
  `glucose_unspecified`.

Purely additive: the existing `glucose` series and every other metric are
unchanged, so the current client keeps working. Backend only. Gate = `npm test` +
`npm run typecheck`.

## Capabilities

### Modified Capabilities

- `vitals-trends`: glucose readings carry a structured meal context, and the trend
  additionally exposes per-context glucose series (fasting / pre-meal / post-meal /
  unspecified) alongside the existing combined glucose series.
