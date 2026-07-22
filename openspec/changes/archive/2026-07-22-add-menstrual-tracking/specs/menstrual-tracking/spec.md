## ADDED Requirements

### Requirement: Per-user list of menstrual periods

The system SHALL persist, per user, a list of menstrual periods. Each period SHALL have a required start date (an ISO calendar date) and an optional end date (also an ISO calendar date, set when the period ends). A user MAY hold any number of periods over time. A period SHALL be added, edited (typically to fill in or change the end date), and deleted independently. When an end date is present it SHALL NOT be earlier than the start date.

#### Scenario: Adding a period stores it
- **WHEN** a user adds a period with a start date and no end date
- **THEN** the period is stored with that start date and no end date

#### Scenario: Editing a period sets its end date
- **WHEN** a user edits an existing open period to set an end date on or after its start date
- **THEN** the period now has that end date

#### Scenario: Editing only one field preserves the other
- **WHEN** a user edits a period supplying only a new start date
- **THEN** the start date changes and the existing end date is preserved (not cleared)

#### Scenario: An end date before the start date is rejected
- **WHEN** a user adds or edits a period with an end date earlier than its start date
- **THEN** the write is rejected as invalid and the period is not stored or changed

#### Scenario: Deleting a period removes it
- **WHEN** a user deletes one of their periods
- **THEN** that period is no longer listed

### Requirement: Derived cycle statistics

The system SHALL derive, on read from the user's stored periods, three statistics without persisting them: the average cycle length (the mean gap in days between consecutive period start dates, over the most recent periods), the average period length (the mean length in days of completed periods, counted inclusively as end minus start plus one), and the predicted next start date (the most recent start date plus the average cycle length). Each statistic SHALL be null when there is not enough data to compute it: the average cycle length needs at least two periods, the average period length needs at least one completed period, and the predicted next start needs an average cycle length.

#### Scenario: Cycle length averages the gaps between starts
- **WHEN** a user has periods starting on 2026-05-01, 2026-05-29, and 2026-06-26
- **THEN** the average cycle length is 28 days and the predicted next start is 2026-07-24

#### Scenario: Period length averages completed periods only
- **WHEN** a user has one period of 2026-05-01 to 2026-05-05 (completed) and one open period with no end date
- **THEN** the average period length is 5 days

#### Scenario: Statistics are null without enough data
- **WHEN** a user has only a single period with no end date
- **THEN** the average cycle length, average period length, and predicted next start are all null

### Requirement: Authenticated menstrual API

The system SHALL expose menstrual tracking over an authenticated HTTP API. `GET /api/menstrual` SHALL return the user's periods (ordered by start date), the derived statistics, and the most recent period (or null when there are none). `POST /api/menstrual` with a start date and optional end date SHALL add a period and return it. `PATCH /api/menstrual/:id` with a start date and/or end date SHALL update that period when it is owned by the caller and return it, or report not-found. `DELETE /api/menstrual/:id` SHALL delete that period when owned and report whether one was deleted. Each endpoint SHALL require authentication. Writing SHALL reject a missing or invalid start date, or an end date earlier than the start date. Editing or deleting a period the caller does not own SHALL NOT change anything.

#### Scenario: Reading the overview returns periods and statistics
- **WHEN** an authenticated user with recorded periods reads the overview
- **THEN** the response lists the periods by start date, the derived statistics, and the most recent period

#### Scenario: The overview for a user with no periods
- **WHEN** an authenticated user with no periods reads the overview
- **THEN** the periods list is empty, the statistics are null, and the last period is null

#### Scenario: Adding rejects a missing start date
- **WHEN** an authenticated user posts without a valid start date
- **THEN** the request is rejected as invalid and nothing is stored

#### Scenario: Editing another user's period does nothing
- **WHEN** an authenticated user edits or deletes a period id that belongs to a different user
- **THEN** nothing is changed for the owner and the caller is told nothing was updated or deleted

#### Scenario: The API rejects an unauthenticated request
- **WHEN** an unauthenticated request is made to any `/api/menstrual` endpoint
- **THEN** the request is rejected as unauthorized
