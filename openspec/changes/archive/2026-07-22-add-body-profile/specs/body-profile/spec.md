## ADDED Requirements

### Requirement: Per-user body profile

The system SHALL persist, per user, a body profile holding a height in centimetres and a target weight in kilograms, both optional (unset until entered). Setting the profile SHALL be a partial update: a field present in the write is stored, a field absent from the write leaves the current value unchanged. Reading a profile that has never been set SHALL report both values as null. Height and target weight, when provided, SHALL be positive numbers.

#### Scenario: Reading an unset profile
- **WHEN** a user reads a body profile they have never set
- **THEN** both the height and the target weight are null

#### Scenario: Setting height and target weight
- **WHEN** a user sets a height of 165 and a target weight of 51
- **THEN** reading the profile returns height 165 and target weight 51

#### Scenario: A partial update leaves the other field unchanged
- **WHEN** a user with a stored height and target weight updates only the target weight
- **THEN** the target weight changes and the stored height is unchanged

#### Scenario: A non-positive or non-numeric value is rejected
- **WHEN** a user sets a height or target weight that is not a positive number
- **THEN** the write is rejected as invalid and nothing is stored

### Requirement: Weight-goal overview

The system SHALL derive, on read, a weight-goal overview from the user's body profile and their recorded weights (from the vitals tracker): the height, the target weight, the current weight (the most recent recorded weight, or null when none), the remaining weight to target (current − target, null when either is missing), the BMI (current ÷ (height/100)², to one decimal, null when either is missing), and the achievement rate. The achievement rate SHALL be `(baseline − current) / (baseline − target)` clamped to 0–100, where the baseline is the earliest recorded weight; it SHALL be null when there is no baseline, no current weight, no target, or the baseline equals the target.

#### Scenario: Full overview
- **WHEN** a user has height 165, target weight 51, an earliest recorded weight of 55, and a latest recorded weight of 52
- **THEN** the overview reports current 52, remaining 1, a BMI of 19.1, and an achievement rate of 75 (from (55−52)/(55−51))

#### Scenario: BMI and remaining are null without the inputs
- **WHEN** a user has no target weight set
- **THEN** the remaining weight and the achievement rate are null (BMI still computes if height and a current weight exist)

#### Scenario: Achievement rate is null without enough data
- **WHEN** a user has a target and a current weight but only one recorded weight (baseline equals current)
- **THEN** the achievement rate is null

### Requirement: Authenticated body-profile API

The system SHALL expose the body profile and weight-goal overview over an authenticated HTTP API. `GET /api/body-profile` SHALL return the height and target weight. `PUT /api/body-profile` with a height and/or target weight SHALL partially upsert the profile and return it. `GET /api/weight-goal` SHALL return the derived overview. Each endpoint SHALL require authentication, and writing SHALL reject a non-positive or non-numeric value.

#### Scenario: The API rejects an unauthenticated request
- **WHEN** an unauthenticated request is made to any `/api/body-profile` or `/api/weight-goal` endpoint
- **THEN** the request is rejected as unauthorized

#### Scenario: Writing rejects a junk value
- **WHEN** an authenticated user PUTs a height that is not a number (or is zero or negative)
- **THEN** the request is rejected as invalid and the stored profile is unchanged
