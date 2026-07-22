# vitals-trends Specification

## Purpose
TBD - created by archiving change add-vitals-range. Update Purpose after archive.
## Requirements
### Requirement: Vitals metrics as daily time series over a range

The system SHALL derive, from the user's vitals records in a given date range, a per-metric daily time series for weight, body fat, systolic and diastolic blood pressure, pulse, glucose, and blood oxygen. Each series SHALL be a list of `{ day, value }` points ordered by day, with one point per day that has a value for that metric and no point for a day that has none. For the scalar metrics (weight, body fat) the point value SHALL be that day's recorded scalar. For the reading-based metrics the point value SHALL be the daily mean of that day's readings: systolic and diastolic from the blood-pressure readings; pulse from every recorded pulse that day (across blood-pressure and blood-oxygen readings); glucose from the glucose readings; blood oxygen from the blood-oxygen readings. Weight and body fat SHALL be reported to one decimal; the reading-based means SHALL be rounded to whole numbers.

#### Scenario: Scalars become one point per recorded day
- **WHEN** a user recorded weight 52 on 2026-07-01 and weight 51.7 on 2026-07-03 (and no weight on 2026-07-02)
- **THEN** the weight series is [{2026-07-01, 52}, {2026-07-03, 51.7}] with no point on 2026-07-02

#### Scenario: A day's readings are averaged
- **WHEN** on 2026-07-01 a user has blood-pressure readings of 118/76 and 122/80
- **THEN** the systolic series has a point {2026-07-01, 120} and the diastolic series {2026-07-01, 78}

#### Scenario: Pulse combines blood-pressure and blood-oxygen pulses
- **WHEN** on 2026-07-01 a user has a blood-pressure reading with pulse 70 and a blood-oxygen reading with pulse 74
- **THEN** the pulse series has a point {2026-07-01, 72}

#### Scenario: A metric with no data has an empty series
- **WHEN** a user recorded no glucose readings in the range
- **THEN** the glucose series is empty

### Requirement: Authenticated vitals range API

The system SHALL expose the vitals time series over an authenticated HTTP API. `GET /api/vitals/range?from=&to=` SHALL return `{ from, to, series }` where `series` holds the weight, body_fat, systolic, diastolic, pulse, glucose, and spo2 series for the records in `[from, to]`. The endpoint SHALL require authentication and SHALL reject a missing or invalid `from`/`to`, or a `from` later than `to`, with 400.

#### Scenario: Reading a range returns the series
- **WHEN** an authenticated user requests the range covering their recorded vitals
- **THEN** the response contains the from/to and each metric's daily series

#### Scenario: The API rejects a backwards range
- **WHEN** an authenticated user requests a range whose `from` is later than its `to`
- **THEN** the request is rejected as invalid

#### Scenario: The API rejects an unauthenticated request
- **WHEN** an unauthenticated request is made to `/api/vitals/range`
- **THEN** the request is rejected as unauthorized

