## ADDED Requirements

### Requirement: Logged days in a month

The system SHALL let a user retrieve, for a given calendar month, the distinct
dates in that month on which they have at least one food entry, returned in
ascending order. The month MUST be supplied as `YYYY-MM`; a missing or malformed
month SHALL be rejected with a client error. The result SHALL be scoped to the
requesting user's own entries.

#### Scenario: Distinct logged days ascending
- **WHEN** a user has entries on 2026-07-04, two more on 2026-07-01, and one on 2026-07-20
- **THEN** the system returns `["2026-07-01", "2026-07-04", "2026-07-20"]`

#### Scenario: Other months excluded
- **WHEN** a user has entries in June and August but the month queried is 2026-07 with no July entries
- **THEN** the system returns an empty list

#### Scenario: February query does not error
- **WHEN** a user queries the month 2026-02
- **THEN** the system returns that month's logged days without a date-range error

#### Scenario: Malformed month rejected
- **WHEN** a user requests logged days with a month that is not `YYYY-MM` (e.g. `2026-13` or `2026/07`)
- **THEN** the system rejects the request with a client error

#### Scenario: Scoped to the requesting user
- **WHEN** two users each have entries in 2026-07 and user A queries 2026-07
- **THEN** the system returns only the days on which user A has entries, not user B's
