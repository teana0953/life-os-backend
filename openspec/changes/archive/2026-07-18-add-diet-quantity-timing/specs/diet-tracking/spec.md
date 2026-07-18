## MODIFIED Requirements

### Requirement: Log entry from a dictionary item

The system SHALL let an authenticated user create a food entry from a dictionary
item for a given day and meal, with an optional `quantity` (default 1, a finite
number greater than 0, decimals allowed). The new entry's atomic nutrients and
food-group portion attribution SHALL be the dictionary item's values multiplied
by `quantity`, and the entry SHALL set `source` to `dict`.

#### Scenario: Create entry from dictionary with default quantity
- **WHEN** a user logs dictionary item `香蕉/1根` (2 fruit portions) to breakfast on a day with no quantity
- **THEN** a food entry is created for that day/meal carrying the item's nutrients and 2 fruit portions with source `dict`

#### Scenario: Quantity scales portions and nutrients
- **WHEN** a user logs dictionary item `飯/1碗` (4 staple portions, 60 g carbohydrate) with quantity 1.5
- **THEN** the created entry carries 6 staple portions and 90 g carbohydrate

### Requirement: Per-day per-meal organization

A food entry SHALL belong to a calendar day and a meal. Meal SHALL be one of the
standard meals (breakfast / lunch / dinner) or a user-provided snack label. The
system SHALL return a day's entries ordered by their `eaten_at` time and grouped
by meal in that order, so meals and snacks appear in the order they were eaten.

#### Scenario: Entries grouped by meal
- **WHEN** a user requests a day's diet log
- **THEN** the system returns that day's entries grouped by their meal

#### Scenario: Ordered by eaten-at, not record time
- **WHEN** a day has a breakfast entry eaten at 08:00 that was recorded (logged) after a dinner entry eaten at 19:00
- **THEN** the breakfast group still sorts before the dinner group, because ordering uses eaten-at

## ADDED Requirements

### Requirement: Gram-based dictionary logging

When a dictionary item has a `base_grams`, the system SHALL let the user log it
by a gram amount instead of a unit multiple: the amount SHALL be converted to a
quantity as `grams ÷ base_grams`, which then scales portions and nutrients per
the dictionary-logging rule. `grams` and `quantity` are mutually exclusive — when
`grams` is supplied it determines the quantity, and supplying both SHALL be
rejected with a client error. When a dictionary item has no `base_grams` (null),
the system SHALL reject a gram-based log with a client error.

#### Scenario: Gram amount converts to quantity
- **WHEN** a user logs `飯/50g` (base_grams 50, 1 staple portion) by 33 grams
- **THEN** the entry carries 33 ÷ 50 = 0.66 staple portions

#### Scenario: Gram entry rejected without base grams
- **WHEN** a user attempts to log `飯/1碗` (base_grams null) by a gram amount
- **THEN** the system rejects the request with a client error

#### Scenario: Grams and quantity are mutually exclusive
- **WHEN** a user logs a dictionary item supplying both a gram amount and a quantity
- **THEN** the system rejects the request with a client error

### Requirement: User-settable eaten-at time

A food entry SHALL carry an `eaten_at` timestamp separate from the system
`logged_at` (when the record was created). `eaten_at` SHALL default to the
creation time and MAY be set or overridden by the user. `logged_at` SHALL remain
a system-assigned audit timestamp and MUST NOT be user-settable.

#### Scenario: Eaten-at defaults to now
- **WHEN** a user creates an entry without an eaten-at time
- **THEN** the entry's eaten_at is set to the creation time

#### Scenario: User sets eaten-at
- **WHEN** a user creates an entry with an explicit eaten-at time
- **THEN** the entry stores that eaten-at time while logged_at remains the system time
