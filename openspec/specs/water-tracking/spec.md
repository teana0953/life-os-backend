# water-tracking Specification

## Purpose
TBD - created by archiving change water-tracking. Update Purpose after archive.
## Requirements
### Requirement: Per-day water intake total

The system SHALL persist, per user and per calendar day, a single running total of water consumed in millilitres. Adding water SHALL adjust that day's total by the given amount, and the stored total SHALL never fall below zero (a negative adjustment corrects an over-count but clamps at zero). Reading a day with no recorded intake SHALL report a total of zero.

#### Scenario: Adding water accumulates the day's total
- **WHEN** a user adds 250 then 500 millilitres of water for a day
- **THEN** that day's total reads 750 millilitres

#### Scenario: A correction never drives the total below zero
- **WHEN** a user's day total is 200 millilitres and a −500 adjustment is applied
- **THEN** the stored total for that day is 0, not negative

### Requirement: Per-day water target with carry-forward

The system SHALL let a user set a per-day water target in millilitres, and SHALL resolve a day's target exactly as the diet daily portion target resolves: the target for a day is that day's set value if one exists, otherwise the target carried forward from the most recent earlier day that has a set target, otherwise zero. Setting a target for a day SHALL upsert that day's target. The target SHALL be a single millilitre value (no bonus).

#### Scenario: A set target applies to its day
- **WHEN** a user sets a water target of 2000 millilitres for a day and reads that day
- **THEN** the day reports a target of 2000 millilitres

#### Scenario: A later day with no target carries the last set target forward
- **WHEN** a user set a 2000 millilitre target on an earlier day and never set one since
- **THEN** a later day with no target of its own reports a target of 2000 millilitres

#### Scenario: A day before any target was ever set reports zero
- **WHEN** no water target has ever been set on or before a given day
- **THEN** that day reports a target of 0 millilitres

### Requirement: Authenticated water API

The system SHALL expose the water intake and target over an authenticated HTTP API. `GET /api/water?day=` SHALL return the day's total, resolved target, and remaining (target minus total, which MAY be negative). `POST /api/water` with a day and an add amount SHALL apply the adjustment and return the new total. `PUT /api/water/target` with a day and a target SHALL upsert that day's target and return it. Each endpoint SHALL require authentication and SHALL reject a missing day or a non-numeric amount.

#### Scenario: Reading a day returns total, target, and remaining
- **WHEN** an authenticated user has drunk 750 millilitres against a 2000 millilitre target for a day and reads that day
- **THEN** the response reports total 750, target 2000, and remaining 1250 millilitres

#### Scenario: Remaining may be negative when over the target
- **WHEN** an authenticated user has drunk 2200 millilitres against a 2000 millilitre target
- **THEN** the response reports remaining −200 millilitres

#### Scenario: The API rejects an unauthenticated request
- **WHEN** an unauthenticated request is made to any `/api/water` endpoint
- **THEN** the request is rejected as unauthorized

