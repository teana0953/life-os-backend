# diet-tracking Specification

## Purpose
TBD - created by archiving change add-diet-tracking. Update Purpose after archive.
## Requirements
### Requirement: Nutrient–portion–calorie conversion

The system SHALL own conversion rules following the Taiwan MOHW food-exchange
standard, applied per food group:

- 1 staple (主食) portion = 15 g carbohydrate
- 1 meat/protein (肉類) portion = 7 g protein
- 1 fruit (水果) portion = 15 g carbohydrate (≈ 60 kcal)
- 1 vegetable (蔬菜) portion = 5 g carbohydrate

Calories for an entry SHALL be taken from an explicitly provided `kcal` when
present (nutrition label or AI estimate); otherwise the system SHALL compute
kcal from macros as `carb_g×4 + protein_g×4 + fat_g×9`. Calories SHALL NEVER be
derived from portion counts.

#### Scenario: Portion to grams
- **WHEN** the system converts 1 staple portion to grams
- **THEN** it yields 15 g carbohydrate

#### Scenario: Grams to portion within a group
- **WHEN** an entry attributes 7 g of protein to the meat group
- **THEN** it projects to 1 meat portion

#### Scenario: Calories fall back to macros
- **WHEN** an entry has macros but no explicit kcal
- **THEN** the system computes kcal as carb_g×4 + protein_g×4 + fat_g×9

### Requirement: Atomic nutrient store of record

A food entry SHALL persist atomic nutrients
`{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }` as its store of record.
Daily and per-entry nutrient and calorie totals SHALL be computed only from
these fields, never from portion counts.

#### Scenario: Nutrient totals come from atomic fields
- **WHEN** a day's calorie total is requested
- **THEN** it is computed by summing the atomic nutrient/kcal fields of that day's entries, independent of any portion values

### Requirement: Food-group portion attribution

A food entry SHALL record its food-group portion attribution
`{ staple, meat, fruit, veg }`. This is required because grams alone cannot
distinguish carbohydrate belonging to the staple group from carbohydrate
belonging to the fruit group — the group assignment is human knowledge, not
recoverable from nutrients. These portion values carry the categorization axis
and are used for portion-target reporting and display; they MUST NOT be used to
compute calories or nutrient totals.

When an entry is created from nutrients without a food-group classification
(e.g. an AI estimate that has not been categorized), its portion attribution
SHALL be zero and the entry SHALL be marked `unclassified` via an explicit flag
(not inferred from all-zero portions, so a legitimately group-less food is not
mistaken for one needing categorization). Such entries contribute to
nutrient/calorie totals but not to portion-based target consumption, and the
system SHALL surface unclassified entries so the user can categorize them.

#### Scenario: Same carbohydrate, different group
- **WHEN** two entries each carry 15 g carbohydrate, one attributed to staple and one to fruit
- **THEN** the first reports 1 staple portion and the second reports 1 fruit portion, while both contribute the same carbohydrate to nutrient totals

#### Scenario: Unclassified nutrient-only entry
- **WHEN** an entry is created from nutrients with no food-group classification
- **THEN** it is marked unclassified, contributes to the day's calorie total, and does not reduce any category's remaining portions

### Requirement: Entry source provenance

Each food entry SHALL record a `source` of `manual`, `ai_photo`, or `dict`.
Regardless of source, the persisted store of record SHALL be the atomic
nutrients; for `manual` and `dict` sources the nutrients MAY be derived from
supplied portions using the conversion rules, and for `ai_photo` the nutrients
come from the estimate.

#### Scenario: Dictionary source records provenance
- **WHEN** an entry is created by logging a dictionary item
- **THEN** the entry's source is `dict`

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

### Requirement: Manual food entry

The system SHALL let an authenticated user create a food entry by supplying an
optional name, an optional photo reference, and either atomic nutrients or
food-group portions. When only portions are supplied, the system SHALL derive
atomic nutrients via the conversion rules; when nutrients are supplied, the
system SHALL store them as given.

#### Scenario: Manual entry from portions
- **WHEN** a user creates an entry supplying 2 staple portions and no nutrients
- **THEN** the entry is stored with derived nutrients (~30 g carbohydrate) and source `manual`

### Requirement: Delete a food entry

The system SHALL let an authenticated user delete one of their own food entries.
A user MUST NOT be able to delete another user's entry.

#### Scenario: Delete removes entry from the day
- **WHEN** a user deletes one of their own food entries
- **THEN** the entry no longer appears in that day's diet log and no longer counts toward that day's portion or nutrient totals

### Requirement: Daily portion target

The system SHALL let a user hold, per day, per-category base portion goals
`{ staple, meat, fruit, veg }` plus a reserved additive `bonus` contribution
(default 0) representing future exercise-earned portions.

When a day has its own set target, the effective target for a category SHALL be
that day's `base + bonus`. When a day has **no** set target of its own, its base
SHALL carry forward from the most recent target the user set on or before that
day, and its `bonus` SHALL be 0; when the user has never set any target, the
base and bonus SHALL both be 0. Setting a target for a specific day (including a
target with all-zero base) overrides carry-forward for that day.

The system SHALL report, per category, the remaining portions as
`effective_target − sum(logged portions)`.

#### Scenario: Remaining portions
- **WHEN** a day has an effective staple target of 12 and logged entries totaling 9 staple portions
- **THEN** the system reports 3 staple portions remaining

#### Scenario: Bonus adds to base
- **WHEN** a day's base staple goal is 12 and its bonus is 2
- **THEN** the effective staple target is 14

#### Scenario: Untouched day carries forward the last set base
- **WHEN** a user set a staple base of 12 on 2026-07-01 and has set no target on 2026-07-02
- **THEN** 2026-07-02 reports a staple base of 12 with a bonus of 0

#### Scenario: Carry-forward does not carry the source day's bonus
- **WHEN** a user set a staple base of 12 with bonus 3 on 2026-07-01 and has set no target on the later day 2026-07-02
- **THEN** 2026-07-02 reports a staple base of 12 with a bonus of 0

#### Scenario: Never-set target reports zero
- **WHEN** a user has never set any daily target
- **THEN** the queried day reports an all-zero base, bonus, and effective target

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

