## ADDED Requirements

### Requirement: Per-day bowel record

The system SHALL persist, per user and per calendar day, a single bowel record holding a count (the number of bowel movements that day, a non-negative integer), an optional normal/abnormal flag, and a free-text note. The normal/abnormal flag SHALL be nullable — an unrecorded day SHALL NOT be treated as normal. Reading a day with no record SHALL report a count of zero, a null flag, and an empty note. Writing SHALL upsert the whole day's record (count, flag, and note together).

#### Scenario: Reading an unrecorded day returns empty defaults
- **WHEN** a user reads a day for which no bowel record exists
- **THEN** the day reports count 0, a null normal/abnormal flag, and an empty note

#### Scenario: Writing upserts the day's record
- **WHEN** a user sets a day's record to count 2, normal true, note "fine"
- **THEN** reading that day returns count 2, normal true, and note "fine"

#### Scenario: The normal flag can be left unset
- **WHEN** a user sets a day's record with count 1 and no normal/abnormal flag
- **THEN** the day's flag reads null (not normal), with count 1

### Requirement: Authenticated bowel API

The system SHALL expose the bowel record over an authenticated HTTP API. `GET /api/bowel?day=` SHALL return the day's count, flag, and note. `PUT /api/bowel` with a day, count, flag, and note SHALL upsert that day's record and return it. Each endpoint SHALL require authentication and SHALL reject a missing day or a non-numeric count.

#### Scenario: Reading a day returns its record
- **WHEN** an authenticated user has a record of count 3 for a day and reads that day
- **THEN** the response reports count 3 with that day's flag and note

#### Scenario: The API rejects an unauthenticated request
- **WHEN** an unauthenticated request is made to any `/api/bowel` endpoint
- **THEN** the request is rejected as unauthorized
