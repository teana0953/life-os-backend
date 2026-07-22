# vitals-tracking Specification

## Purpose
TBD - created by archiving change vitals-tracking. Update Purpose after archive.
## Requirements
### Requirement: Per-day vitals record

The system SHALL persist, per user and per calendar day, a vitals record holding weight and body fat (each an optional scalar recorded only when measured) plus three lists of repeated measurements: blood-pressure readings (each with systolic, diastolic, and the pulse it was taken with), blood-glucose readings (each with a label and a mg/dL value), and blood-oxygen readings (each with an SpO₂ percentage and an optional pulse). The scalars SHALL be nullable and each list SHALL default to empty. Reading a day with no record SHALL report both scalars null and three empty lists. Writing SHALL upsert the whole day's record — both scalars and all three lists together.

#### Scenario: Reading an unrecorded day returns empty defaults
- **WHEN** a user reads a day with no vitals record
- **THEN** the day reports weight and body fat null and empty blood-pressure, glucose, and blood-oxygen lists

#### Scenario: Writing upserts scalars and all three lists
- **WHEN** a user sets a day to weight 65.5, two blood-pressure readings (120/80 pulse 70, 118/78 pulse 72), one glucose reading ("餐前" 95), and one blood-oxygen reading (98% pulse 71)
- **THEN** reading that day returns weight 65.5 and those blood-pressure, glucose, and blood-oxygen readings in order

#### Scenario: A pulse may be omitted from a reading
- **WHEN** a blood-oxygen reading is recorded with an SpO₂ but no pulse
- **THEN** that reading is stored with a null pulse

### Requirement: Authenticated vitals API

The system SHALL expose the vitals record over an authenticated HTTP API. `GET /api/vitals?day=` SHALL return the day's scalars and three lists. `PUT /api/vitals` with a day, the scalars, and the three lists SHALL upsert that day's record and return it. Each endpoint SHALL require authentication and SHALL reject a missing day, a non-numeric scalar, or a malformed reading.

#### Scenario: Reading a day returns its vitals
- **WHEN** an authenticated user has a record for a day and reads that day
- **THEN** the response reports that day's scalars and its blood-pressure, glucose, and blood-oxygen readings

#### Scenario: A malformed reading is rejected
- **WHEN** an authenticated PUT includes a reading that is not an object or is missing a required numeric value
- **THEN** the request is rejected with a client error, not a server error

#### Scenario: The API rejects an unauthenticated request
- **WHEN** an unauthenticated request is made to any `/api/vitals` endpoint
- **THEN** the request is rejected as unauthorized

