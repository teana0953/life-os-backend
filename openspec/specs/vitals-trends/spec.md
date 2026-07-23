# vitals-trends Specification

## Purpose
TBD - created by archiving change add-vitals-range. Update Purpose after archive.
## Requirements
### Requirement: Vitals metrics as daily time series over a range

The system SHALL derive, from the user's vitals records in a given date range, a per-metric daily time series for weight, body fat, systolic and diastolic blood pressure, pulse, glucose, and blood oxygen. Each series SHALL be a list of `{ day, value }` points ordered by day, with one point per day that has a value for that metric and no point for a day that has none. For the scalar metrics (weight, body fat) the point value SHALL be that day's recorded scalar. For the reading-based metrics the point value SHALL be the daily mean of that day's readings: systolic and diastolic from the blood-pressure readings; pulse from every recorded pulse that day (across blood-pressure and blood-oxygen readings); glucose from the glucose readings; blood oxygen from the blood-oxygen readings. In addition, the system SHALL derive four glucose sub-series split by the readings' meal context — fasting, pre-meal, post-meal, and unspecified (readings with no meal context) — each the daily mean of that context's glucose readings. Weight and body fat SHALL be reported to one decimal; the reading-based means SHALL be rounded to whole numbers.

#### Scenario: Scalars become one point per recorded day
- **WHEN** a user recorded weight 52 on 2026-07-01 and weight 51.7 on 2026-07-03 (and no weight on 2026-07-02)
- **THEN** the weight series is [{2026-07-01, 52}, {2026-07-03, 51.7}] with no point on 2026-07-02

#### Scenario: A day's readings are averaged
- **WHEN** on 2026-07-01 a user has blood-pressure readings of 118/76 and 122/80
- **THEN** the systolic series has a point {2026-07-01, 120} and the diastolic series {2026-07-01, 78}

#### Scenario: Pulse combines blood-pressure and blood-oxygen pulses
- **WHEN** on 2026-07-01 a user has a blood-pressure reading with pulse 70 and a blood-oxygen reading with pulse 74
- **THEN** the pulse series has a point {2026-07-01, 72}

#### Scenario: Glucose splits by meal context
- **WHEN** on 2026-07-01 a user has glucose readings 95 (fasting), 130 (post_meal), and 110 (no meal context)
- **THEN** the glucose series has a point {2026-07-01, 112} (the mean of all three), the fasting series {2026-07-01, 95}, the post-meal series {2026-07-01, 130}, the unspecified series {2026-07-01, 110}, and the pre-meal series is empty

#### Scenario: A metric with no data has an empty series
- **WHEN** a user recorded no glucose readings in the range
- **THEN** the glucose series and all four glucose sub-series are empty

### Requirement: Authenticated vitals range API

The system SHALL expose the vitals time series over an authenticated HTTP API. `GET /api/vitals/range?from=&to=` SHALL return `{ from, to, series }` where `series` holds the weight, body_fat, systolic, diastolic, pulse, glucose, spo2, and the four glucose context series (glucose_fasting, glucose_pre_meal, glucose_post_meal, glucose_unspecified) for the records in `[from, to]`. The endpoint SHALL require authentication and SHALL reject a missing or invalid `from`/`to`, or a `from` later than `to`, with 400.

#### Scenario: Range returns the series for the window
- **WHEN** an authenticated user requests `GET /api/vitals/range?from=2026-07-01&to=2026-07-07`
- **THEN** the response is 200 with `{ from, to, series }`, series carrying each metric's points including the four glucose context series

#### Scenario: Unauthenticated range is rejected
- **WHEN** an unauthenticated request hits `GET /api/vitals/range`
- **THEN** the response is 401

### Requirement: Glucose readings carry a structured meal context

A glucose reading SHALL carry a meal context of `fasting`, `pre_meal`, `post_meal`, or none (null). On `PUT /api/vitals` the reading's `meal_context` field, when present and non-null, MUST be exactly one of `fasting` / `pre_meal` / `post_meal`; any other value SHALL be rejected with 400. An absent or null `meal_context` SHALL be accepted and stored as no context. The context SHALL round-trip through storage and be returned as `meal_context` in the vitals record JSON.

#### Scenario: A valid meal context is accepted and returned
- **WHEN** a user saves a glucose reading with `meal_context` `fasting`
- **THEN** the save succeeds and reading back the day returns that reading with `meal_context` `fasting`

#### Scenario: An unknown meal context is rejected
- **WHEN** a user saves a glucose reading with `meal_context` `"brunch"`
- **THEN** the response is 400

#### Scenario: A missing meal context is stored as none
- **WHEN** a user saves a glucose reading with no `meal_context` field
- **THEN** the save succeeds and the reading reads back with `meal_context` null

