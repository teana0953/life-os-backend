# chaodays-import Specification

## Purpose
TBD - created by archiving change import-chaodays-weight. Update Purpose after archive.
## Requirements
### Requirement: Import chaodays weight and body fat into vitals

An authenticated lifeos user SHALL be able to import their chaodays weight and
body-fat records for a date range into their lifeos vitals, by supplying their
chaodays credentials. Each imported day SHALL set only the day's weight and body
fat, preserving any existing blood-pressure, glucose, and blood-oxygen readings on
that day. The response SHALL summarize how many days were imported and skipped.

#### Scenario: Weight and body fat are imported for the range
- **WHEN** the user POSTs valid chaodays credentials and a `start_date`/`end_date` range
- **THEN** each chaodays weight record in range is written to that day's vitals (weight + body fat), and the response reports the imported and skipped counts and the range

#### Scenario: Import preserves other vitals on the same day
- **WHEN** a day being imported already has blood-pressure or glucose readings in lifeos
- **THEN** the import updates only that day's weight and body fat and leaves the existing readings intact

#### Scenario: A record without a weight is skipped
- **WHEN** a chaodays weight record in range has no weight value
- **THEN** that day is counted as skipped and not written

#### Scenario: A missing body fat does not erase an existing one
- **WHEN** a chaodays weight record has a weight but no body-fat value, and that day already has a body-fat value in lifeos
- **THEN** the import updates the weight and leaves the existing body fat intact

### Requirement: chaodays credentials are used transiently, never stored

The chaodays password and the resulting session token SHALL be used only within
the request to authenticate to chaodays and pull data, and SHALL NOT be persisted
to the database, logs, or environment.

#### Scenario: Credentials are not persisted
- **WHEN** an import completes (successfully or with an error)
- **THEN** no chaodays password or session token is written to storage or logs

### Requirement: Upstream and validation failures map to distinct responses

Invalid input SHALL return 400; wrong chaodays credentials SHALL return 400
`chaodays_auth_failed`; a chaodays upstream failure (non-auth) SHALL return 502
`chaodays_unavailable` rather than a lifeos-internal 500.

#### Scenario: Missing or malformed input is rejected
- **WHEN** the request omits `chaodays_uid`/`chaodays_password`, or `start_date`/`end_date` is not a valid `YYYY-MM-DD` with start ≤ end
- **THEN** the API returns 400

#### Scenario: Wrong chaodays credentials
- **WHEN** chaodays rejects the sign-in
- **THEN** the API returns 400 `chaodays_auth_failed`

#### Scenario: chaodays upstream is unavailable
- **WHEN** chaodays returns a non-auth error or is unreachable
- **THEN** the API returns 502 `chaodays_unavailable`

