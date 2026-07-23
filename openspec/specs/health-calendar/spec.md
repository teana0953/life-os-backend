# health-calendar Specification

## Purpose
TBD - created by archiving change health-calendar. Update Purpose after archive.
## Requirements
### Requirement: Monthly logged days across trackers

The system SHALL determine, for a user and a calendar month, the set of days that have at least one entry across the day-keyed trackers — meals, water, bowel, exercise, and vitals. A day SHALL appear once regardless of how many trackers or entries it has, and days with no entry SHALL NOT appear.

#### Scenario: A day with any tracker entry is logged
- **WHEN** on 2026-07-05 the user has only a water entry, and on 2026-07-06 only a vitals entry, and nothing on 2026-07-07
- **THEN** the month's logged days include 2026-07-05 and 2026-07-06 but not 2026-07-07

### Requirement: Monthly health summary with logging and diet-adherence rates

The system SHALL expose, over an authenticated HTTP API, a monthly summary `GET /api/health-calendar?month=YYYY-MM` returning `{ year, month, logged_days, days_elapsed, logging_rate, diet_adherence_rate }`. `days_elapsed` SHALL be the day-of-month of the current day for the current month, the number of days in the month for a past month, and 0 for a future month. `logging_rate` SHALL be `round(100 × logged_days_count / days_elapsed)` and `diet_adherence_rate` the rounded percentage of elapsed days that met the diet target (the day has a target and every category is fully logged); both SHALL be null when `days_elapsed` is 0. A missing or malformed `month` SHALL be rejected with 400, and an unauthenticated request with 401.

#### Scenario: Summary reports logging and diet-adherence rates
- **WHEN** an authenticated user requests `GET /api/health-calendar?month=2026-07` for a past month with 31 days, having logged on 20 days and met the diet target on 10
- **THEN** the response is 200 with `days_elapsed` 31, `logging_rate` 65, and `diet_adherence_rate` 32

#### Scenario: A future month has no elapsed days
- **WHEN** an authenticated user requests a month later than the current month
- **THEN** `days_elapsed` is 0 and `logging_rate` and `diet_adherence_rate` are null

#### Scenario: A malformed month is rejected
- **WHEN** the request omits `month` or passes `2026-13`
- **THEN** the response is 400

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated request hits `GET /api/health-calendar`
- **THEN** the response is 401

