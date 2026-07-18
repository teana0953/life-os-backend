## ADDED Requirements

### Requirement: Update a food entry

The system SHALL let an authenticated user update one of their own food entries —
its name, meal, eaten-at time, and/or food-group portions. A user MUST NOT be
able to update another user's entry (treated as not found, making no change). At
least one updatable field MUST be supplied; an update with no fields SHALL be
rejected. When portions are supplied, the atomic nutrients SHALL be recomputed
from the portions via the conversion rules and the entry SHALL be marked
classified (`unclassified` = false). Fields not supplied SHALL keep their current
values. When the eaten-at time is updated, the entry's day SHALL be kept
consistent with it (the day equals the eaten-at calendar date).

#### Scenario: Updating portions recomputes nutrients
- **WHEN** a user updates an entry's portions to 2 staple
- **THEN** the entry stores 2 staple portions, its carbohydrate is recomputed to ~30 g, and `unclassified` is false

#### Scenario: Updating only name, meal, or time leaves other fields unchanged
- **WHEN** a user updates only an entry's meal to `lunch`
- **THEN** the entry's meal is `lunch` and its portions, nutrients, name, and eaten-at are unchanged

#### Scenario: Cannot update another user's entry
- **WHEN** a user attempts to update an entry they do not own
- **THEN** the system reports not found and makes no change

#### Scenario: An empty update is rejected
- **WHEN** a user submits an update with no updatable fields
- **THEN** the system rejects it as a client error and makes no change

#### Scenario: Editing the time across a day boundary moves the entry's day
- **WHEN** a user updates an entry's eaten-at time to a different calendar date
- **THEN** the entry's day is updated to that date so day and eaten-at stay consistent
