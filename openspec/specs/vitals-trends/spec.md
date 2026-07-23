# vitals-trends Specification

## Purpose
TBD - created by archiving change add-vitals-range. Update Purpose after archive.
## Requirements
### Requirement: Vitals metrics as daily time series over a range

The system SHALL derive, from the user's vitals records in a given date range, a per-metric time series for weight, body fat, systolic and diastolic blood pressure, pulse, glucose, and blood oxygen. Each series SHALL be a list of `{ day, time, value }` points ordered by day then time-of-day. For the scalar metrics (weight, body fat) the series SHALL carry one point per recorded day with an empty `time` and the value reported to one decimal. For the reading-based metrics the series SHALL carry one point per reading at the reading's time-of-day (`HH:mm`), rounded to a whole number: systolic and diastolic from each blood-pressure reading; pulse from every recorded pulse across blood-pressure and blood-oxygen readings; glucose from each glucose reading; blood oxygen from each blood-oxygen reading. Each glucose point SHALL additionally carry its meal context (`fasting` / `pre_meal` / `post_meal` / null). A day with no reading for a metric SHALL contribute no point.

#### Scenario: Scalars become one point per recorded day
- **WHEN** a user recorded weight 52 on 2026-07-01 and weight 51.7 on 2026-07-03 (and no weight on 2026-07-02)
- **THEN** the weight series is [{2026-07-01, "", 52}, {2026-07-03, "", 51.7}] with no point on 2026-07-02

#### Scenario: Each reading is its own point, ordered by time
- **WHEN** on 2026-07-01 a user has blood-pressure readings 118/76 at 08:00 and 122/80 at 20:00
- **THEN** the systolic series is [{2026-07-01, 08:00, 118}, {2026-07-01, 20:00, 122}] and the diastolic series [{2026-07-01, 08:00, 76}, {2026-07-01, 20:00, 80}]

#### Scenario: Pulse draws one point per reading across blood-pressure and blood-oxygen
- **WHEN** on 2026-07-01 a user has a blood-pressure reading with pulse 70 at 08:00 and a blood-oxygen reading with pulse 74 at 20:00
- **THEN** the pulse series is [{2026-07-01, 08:00, 70}, {2026-07-01, 20:00, 74}]

#### Scenario: Each glucose reading is a point carrying its meal context
- **WHEN** on 2026-07-01 a user has glucose readings 95 (fasting) at 07:00, 130 (post_meal) at 13:00, and 110 (no context) at 18:00
- **THEN** the glucose series is [{2026-07-01, 07:00, 95, fasting}, {2026-07-01, 13:00, 130, post_meal}, {2026-07-01, 18:00, 110, null}]

#### Scenario: A metric with no data has an empty series
- **WHEN** a user recorded no glucose readings in the range
- **THEN** the glucose series is empty

### Requirement: Authenticated vitals range API

The system SHALL expose the vitals time series over an authenticated HTTP API. `GET /api/vitals/range?from=&to=` SHALL return `{ from, to, series }` where `series` holds the weight, body_fat, systolic, diastolic, pulse, glucose, and spo2 series for the records in `[from, to]`. Each series point SHALL be `{ day, time, value }`, and each glucose point SHALL additionally carry `meal_context`. The endpoint SHALL require authentication and SHALL reject a missing or invalid `from`/`to`, or a `from` later than `to`, with 400.

#### Scenario: Range returns the per-reading series for the window
- **WHEN** an authenticated user requests `GET /api/vitals/range?from=2026-07-01&to=2026-07-07`
- **THEN** the response is 200 with `{ from, to, series }`, each series carrying one `{ day, time, value }` point per reading (glucose points also carrying `meal_context`)

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

