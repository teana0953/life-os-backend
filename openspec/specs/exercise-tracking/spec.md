# exercise-tracking Specification

## Purpose
TBD - created by archiving change add-exercise-tracking. Update Purpose after archive.
## Requirements
### Requirement: Static activity library

The system SHALL provide a fixed, read-only library of exercise activities. Each activity SHALL have a stable identifier, a name, a category that is either aerobic or anaerobic, and a descriptive intensity label. The library SHALL be shared by all users and SHALL NOT be user-editable in this version.

#### Scenario: Listing the activity library
- **WHEN** an authenticated user requests the activity library
- **THEN** the response lists every activity with its id, name, category, and intensity label

#### Scenario: The library is identical for every user
- **WHEN** two different authenticated users request the activity library
- **THEN** both receive the same set of activities

### Requirement: Per-day list of exercise entries

The system SHALL persist, per user and per calendar day, a list of exercise entries. Each entry SHALL reference an activity from the static library, a duration in minutes (a positive integer), and an optional free-text note (empty when none). A day MAY hold multiple entries, including multiple entries for the same activity. Reading a day with no entries SHALL report an empty list and a total duration of zero. Each entry SHALL be independently removable.

#### Scenario: Reading a day with no entries
- **WHEN** a user reads a day for which no exercise entry exists
- **THEN** the day reports an empty list of entries and a total duration of 0 minutes

#### Scenario: Appending entries accumulates the day
- **WHEN** a user logs a 30-minute activity and then a 20-minute activity on the same day
- **THEN** reading that day returns both entries and a total duration of 50 minutes

#### Scenario: Deleting one entry leaves the others
- **WHEN** a user has two entries on a day and deletes one of them
- **THEN** reading that day returns only the remaining entry, with the total duration reduced accordingly

#### Scenario: An entry is enriched with its activity details on read
- **WHEN** a user reads a day that has an entry referencing an activity from the library
- **THEN** the entry includes that activity's name and category alongside the stored duration and note

### Requirement: Authenticated exercise API

The system SHALL expose exercise tracking over an authenticated HTTP API. `GET /api/exercise/activities` SHALL return the activity library. `GET /api/exercise?day=` SHALL return the day's entries and total duration. `POST /api/exercise` with a day, activity id, duration, and note SHALL append an entry and return it. `DELETE /api/exercise/:id` SHALL delete the entry when it is owned by the caller and report whether one was deleted. Each endpoint SHALL require authentication. Writing SHALL reject a missing day, an activity id that is not in the library, or a duration that is not a positive number. Deleting an entry the caller does not own SHALL NOT delete anything.

#### Scenario: Appending an entry returns it
- **WHEN** an authenticated user posts a day, a valid activity id, a duration of 30, and a note
- **THEN** the response is the created entry and reading that day includes it

#### Scenario: Writing rejects an unknown activity
- **WHEN** an authenticated user posts an activity id that is not in the library
- **THEN** the request is rejected as invalid and nothing is stored

#### Scenario: Writing rejects a non-positive duration
- **WHEN** an authenticated user posts a duration of 0 or a negative or non-numeric duration
- **THEN** the request is rejected as invalid and nothing is stored

#### Scenario: Deleting another user's entry does nothing
- **WHEN** an authenticated user deletes an entry id that belongs to a different user
- **THEN** no entry is deleted and the owner's day is unchanged

#### Scenario: The API rejects an unauthenticated request
- **WHEN** an unauthenticated request is made to any `/api/exercise` endpoint
- **THEN** the request is rejected as unauthorized

