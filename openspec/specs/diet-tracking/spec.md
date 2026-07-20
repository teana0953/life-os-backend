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

Calories for a meal item SHALL be taken from an explicitly provided `kcal` when
present (nutrition label or AI estimate); otherwise the system SHALL compute
kcal from macros as `carb_g×4 + protein_g×4 + fat_g×9`. Calories SHALL NEVER be
derived from portion counts.

#### Scenario: Portion to grams
- **WHEN** the system converts 1 staple portion to grams
- **THEN** it yields 15 g carbohydrate

#### Scenario: Grams to portion within a group
- **WHEN** a meal item attributes 7 g of protein to the meat group
- **THEN** it projects to 1 meat portion

#### Scenario: Calories fall back to macros
- **WHEN** a meal item has macros but no explicit kcal
- **THEN** the system computes kcal as carb_g×4 + protein_g×4 + fat_g×9

### Requirement: Atomic nutrient store of record

A meal item SHALL persist its **per-unit** atomic nutrients
`{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }` (the amount for
`quantity = 1`) together with its `quantity` multiplier as its store of record.
An item's consumed nutrients/calories SHALL be `per-unit × quantity`, derived on
read and never stored. Daily and per-item nutrient and calorie totals SHALL be
computed only from these consumed nutrient/kcal values, never from portion
counts.

#### Scenario: Nutrient totals come from consumed atomic fields
- **WHEN** a day's calorie total is requested
- **THEN** it is computed by summing each meal item's consumed kcal (per-unit kcal × quantity) of that day's items, independent of any portion values

### Requirement: Food-group portion attribution

A meal item SHALL record its **per-unit** food-group portion attribution
`{ staple, meat, fruit, veg }` (the amount for `quantity = 1`); its consumed
portions SHALL be `per-unit × quantity`, derived on read. This attribution is
required because grams alone cannot distinguish carbohydrate belonging to the
staple group from carbohydrate belonging to the fruit group — the group
assignment is human knowledge, not recoverable from nutrients. These portion
values carry the categorization axis and are used for portion-target reporting
and display; they MUST NOT be used to compute calories or nutrient totals.

When a meal item is created from nutrients without a food-group classification
(e.g. an AI estimate that has not been categorized), its portion attribution
SHALL be zero and the item SHALL be marked `unclassified` via an explicit flag
(not inferred from all-zero portions, so a legitimately group-less food is not
mistaken for one needing categorization). Such items contribute to
nutrient/calorie totals but not to portion-based target consumption, and the
system SHALL surface unclassified items so the user can categorize them.

#### Scenario: Same carbohydrate, different group
- **WHEN** two meal items each carry 15 g carbohydrate, one attributed to staple and one to fruit
- **THEN** the first reports 1 staple portion and the second reports 1 fruit portion, while both contribute the same carbohydrate to nutrient totals

#### Scenario: Unclassified nutrient-only item
- **WHEN** a meal item is created from nutrients with no food-group classification
- **THEN** it is marked unclassified, contributes to the day's calorie total, and does not reduce any category's remaining portions

### Requirement: Entry source provenance

Each meal item SHALL record a `source` of `manual`, `ai_photo`, or `dict`.
Regardless of source, the persisted store of record SHALL be the atomic
nutrients; for `manual` and `dict` sources the nutrients MAY be derived from
supplied portions using the conversion rules, and for `ai_photo` the nutrients
come from the estimate.

#### Scenario: Dictionary source records provenance
- **WHEN** a meal item is created by adding a dictionary item to a meal
- **THEN** the item's source is `dict`

### Requirement: Per-day per-meal organization

A meal SHALL be an owner-scoped entity belonging to a calendar day and a meal
slot, unique per `(user, day, meal)`. The meal slot SHALL be one of the standard
meals (breakfast / lunch / dinner) or a user-provided snack label. A meal SHALL
carry a single `time` and SHALL contain zero or more meal items. The system SHALL
return a day's meals ordered by their `time`, each with its items, so meals and
snacks appear in the order they were eaten.

#### Scenario: A day's meals carry their items
- **WHEN** a user requests a day's diet log
- **THEN** the system returns that day's meals, each with its own items

#### Scenario: Ordered by meal time
- **WHEN** a day has a breakfast meal with time 08:00 that was recorded after a dinner meal with time 19:00
- **THEN** the breakfast meal still sorts before the dinner meal, because ordering uses the meal time

### Requirement: Log entry from a dictionary item

The system SHALL let an authenticated user add a dictionary item to a meal for a
given day and meal slot, with an optional `quantity` (default 1, a finite number
greater than 0, decimals allowed). The new meal item SHALL store the dictionary
item's **per-unit** atomic nutrients and food-group portion attribution together
with that `quantity` — the per-unit values SHALL NOT be multiplied at write time —
and SHALL set `source` to `dict`. The item's consumed amount SHALL be
`per-unit × quantity`, derived on read. If the day and slot have no meal yet,
adding the item SHALL create the meal; otherwise the item SHALL be appended to
the existing meal.

#### Scenario: Add dictionary item with default quantity
- **WHEN** a user adds dictionary item `香蕉/1根` (2 fruit portions per unit) to breakfast on a day with no quantity
- **THEN** a meal item is created under that day/meal storing the item's per-unit nutrients and 2 fruit portions per unit with quantity 1 (consumed 2 fruit portions) and source `dict`

#### Scenario: Quantity scales the consumed amount, not the stored per-unit values
- **WHEN** a user adds dictionary item `飯/1碗` (4 staple portions, 60 g carbohydrate per unit) with quantity 1.5
- **THEN** the item stores 4 staple portions and 60 g carbohydrate per unit with quantity 1.5, so its consumed amount is 6 staple portions and 90 g carbohydrate

### Requirement: Manual food entry

The system SHALL let an authenticated user add a manual item to a meal by
supplying an optional name, an optional photo reference, and either atomic
nutrients or food-group portions, all stored as **per-unit** values (`quantity`
defaults to 1). When only portions are supplied, the system SHALL derive the
per-unit atomic nutrients via the conversion rules; when nutrients are supplied,
the system SHALL store them as given and mark the item `unclassified`.

#### Scenario: Manual item from portions
- **WHEN** a user adds an item supplying 2 staple portions per unit and no nutrients
- **THEN** the item stores 2 staple portions per unit with derived per-unit nutrients (~30 g carbohydrate), quantity 1, and source `manual`

### Requirement: Delete a food entry

The system SHALL let an authenticated user delete one of their own meal items. A
user MUST NOT be able to delete another user's meal item (treated as not found,
making no change).

#### Scenario: Delete removes the item from its meal
- **WHEN** a user deletes one of their own meal items
- **THEN** the item no longer appears in that day's log and no longer counts toward that day's portion or nutrient totals

#### Scenario: Cannot delete another user's item
- **WHEN** a user attempts to delete a meal item they do not own
- **THEN** the system reports not found and makes no change

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
`effective_target − sum(logged portions)`, where the logged portions are the sum
of the **consumed portions (per-unit × quantity)** across all of that day's meal
items.

#### Scenario: Remaining portions
- **WHEN** a day has an effective staple target of 12 and meal items whose consumed portions total 9 staple
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

### Requirement: User-settable eaten-at time

A meal SHALL carry a single `time` timestamp for when it was eaten, shared by all
of its items (replacing any per-item eaten-at). `time` SHALL default to the
meal's creation time and MAY be set or overridden by the user, including after
creation. The meal and its items SHALL also record a system `created_at` audit
timestamp that MUST NOT be user-settable. Editing a meal's `time` SHALL adjust
only its time and SHALL NOT move the meal to another day.

#### Scenario: Time defaults to now
- **WHEN** a user creates a meal without a time
- **THEN** the meal's time is set to the creation time

#### Scenario: User sets the meal time
- **WHEN** a user creates or updates a meal with an explicit time
- **THEN** the meal stores that time while its created_at remains the system time

#### Scenario: Editing time keeps the day
- **WHEN** a user updates a meal's time to a clock value on a different calendar date
- **THEN** the meal's time is updated while its day is unchanged

### Requirement: Update a food entry

The system SHALL let an authenticated user update one of their own meal items —
its per-unit food-group portions, or its amount via a new `quantity` or a measure
amount. A user MUST NOT be able to update another user's meal item (treated as
not found, making no change). At least one updatable field MUST be supplied; an
update with no fields SHALL be rejected.

- A `quantity` update SHALL set the `quantity` column only, leaving the per-unit
  portions and nutrients unchanged.
- A measure-amount update SHALL set `quantity = measure ÷ base_amount`, with the
  `measure` interpreted in the item's own `measure_unit` (requiring a non-null
  measure basis, else a client error), likewise leaving the per-unit values
  unchanged.
- A per-unit portions update SHALL set the per-unit portion columns, recompute
  the per-unit nutrients from them via the conversion rules, and mark the item
  classified (`unclassified` = false).

In every case the item's consumed amount remains `per-unit × quantity`, derived
on read; the system SHALL NOT rewrite the stored per-unit values when only the
quantity changes, so there is no double-scaling. Fields not supplied SHALL keep
their current values.

#### Scenario: Updating per-unit portions recomputes per-unit nutrients
- **WHEN** a user updates a meal item's per-unit portions to 2 staple
- **THEN** the item stores 2 staple portions per unit, its per-unit carbohydrate is recomputed to ~30 g, and `unclassified` is false

#### Scenario: Updating quantity rescales only the consumed amount
- **WHEN** a user updates a meal item's quantity from 1 to 2
- **THEN** the stored per-unit portions and nutrients are unchanged while the item's consumed amount (per-unit × quantity) doubles

#### Scenario: Measure update sets quantity via the measure basis
- **WHEN** a user updates a meal item backed by `無糖豆漿/240mL` (base_amount 240, measure_unit `ml`) with a measure of 120
- **THEN** the item's quantity is set to 120 ÷ 240 = 0.5 while its per-unit values are unchanged

#### Scenario: Measure update rejected without a measure basis
- **WHEN** a user submits a measure-amount update for an item whose base_amount is null
- **THEN** the system rejects it as a client error and makes no change

#### Scenario: Cannot update another user's item
- **WHEN** a user attempts to update a meal item they do not own
- **THEN** the system reports not found and makes no change

#### Scenario: An empty update is rejected
- **WHEN** a user submits an update with no updatable fields
- **THEN** the system rejects it as a client error and makes no change

### Requirement: Logged days in a month

The system SHALL let a user retrieve, for a given calendar month, the distinct
dates in that month on which they have at least one meal, returned in ascending
order. The month MUST be supplied as `YYYY-MM`; a missing or malformed month
SHALL be rejected with a client error. The result SHALL be scoped to the
requesting user's own meals.

#### Scenario: Distinct logged days ascending
- **WHEN** a user has meals on 2026-07-04, another on 2026-07-01, and one on 2026-07-20
- **THEN** the system returns `["2026-07-01", "2026-07-04", "2026-07-20"]`

#### Scenario: Other months excluded
- **WHEN** a user has meals in June and August but the month queried is 2026-07 with no July meals
- **THEN** the system returns an empty list

#### Scenario: February query does not error
- **WHEN** a user queries the month 2026-02
- **THEN** the system returns that month's logged days without a date-range error

#### Scenario: Malformed month rejected
- **WHEN** a user requests logged days with a month that is not `YYYY-MM` (e.g. `2026-13` or `2026/07`)
- **THEN** the system rejects the request with a client error

#### Scenario: Scoped to the requesting user
- **WHEN** two users each have meals in 2026-07 and user A queries 2026-07
- **THEN** the system returns only the days on which user A has meals, not user B's

### Requirement: Meal creation with multiple items

The system SHALL let an authenticated user create a meal for a given day and meal
slot with a single `time` and one or more items in a single request. When no meal
exists for that `(user, day, meal)` the system SHALL create it with the supplied
`time`; when a meal already exists for that slot the system SHALL reuse it and
append the supplied items, without creating a duplicate meal. Each item MAY be a
dictionary item (storing the dictionary item's **per-unit** nutrients and
portions plus a `quantity` multiplier — set from an explicit quantity or from a
measure amount in the item's `measure_unit` — with `source` `dict`) or a manual
item (supplied portions or nutrients stored as **per-unit** values, `source`
`manual`). An item's consumed amount SHALL be its per-unit values × its
`quantity`, derived on read and never stored. The meal and its items SHALL be
owned by the requesting user.

#### Scenario: Create a meal with several items at once
- **WHEN** a user posts a lunch for a day with a time and three items to a slot that has no meal yet
- **THEN** the system creates one lunch meal for that day carrying the time and creates its three items

#### Scenario: Adding to an existing meal appends items
- **WHEN** a user posts more items to a day and meal slot that already has a meal
- **THEN** the system reuses that meal and appends the new items, and the day still has a single meal for that slot

### Requirement: Per-day totals across meal items

When a day's log is requested the system SHALL return per-day nutrient totals
`{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }` and per-day food-group
portion totals `{ staple, meat, fruit, veg }`, each computed by summing the
**consumed amount (per-unit × quantity)** of all meal items of all of that day's
meals. Nutrient totals SHALL come only from the atomic nutrient fields and
portion totals only from the portion fields; an unclassified item contributes to
nutrient totals but adds zero to portion totals.

#### Scenario: Totals sum consumed amounts across every meal's items
- **WHEN** a day has two meals whose items' consumed amounts (per-unit × quantity) together come to 6 staple portions and 800 kcal
- **THEN** the day log reports 6 staple portions and 800 kcal in its totals

#### Scenario: Unclassified item adds nutrients but no portions
- **WHEN** a day includes an unclassified meal item whose consumed amount is 200 kcal and zero portions
- **THEN** the day's kcal total includes that 200 kcal while its portion totals are unchanged by that item

### Requirement: Delete a meal

The system SHALL let an authenticated user delete one of their own meals, and
deleting a meal SHALL also delete all of that meal's items (cascade). A user MUST
NOT be able to delete another user's meal (treated as not found, making no
change).

#### Scenario: Deleting a meal removes it and its items
- **WHEN** a user deletes one of their own meals
- **THEN** the meal and all its items no longer appear in that day's log and no longer count toward that day's nutrient or portion totals

#### Scenario: Cannot delete another user's meal
- **WHEN** a user attempts to delete a meal they do not own
- **THEN** the system reports not found and makes no change

### Requirement: Measure-based logging (g or ml)

The system SHALL let a user add a dictionary item that has a measure basis
(`base_amount` + `measure_unit`, where `measure_unit` is `g` or `ml`) to a meal
by a **measure amount** in that item's unit instead of a unit multiple: the
amount SHALL set the item's `quantity` to `measure ÷ base_amount`, leaving the item's
per-unit portions and nutrients unchanged, so that its consumed amount
(per-unit × quantity) reflects the measure. The supplied `measure` SHALL be
interpreted in the item's own `measure_unit`; the system SHALL NOT convert
between grams and millilitres. `measure` and `quantity` are mutually exclusive —
when `measure` is supplied it determines the quantity, and supplying both SHALL be
rejected with a client error. When a dictionary item has no measure basis
(`base_amount` null, a household-unit food), the system SHALL reject a
measure-based add with a client error.

#### Scenario: Gram measure sets the quantity
- **WHEN** a user adds `飯/50g` (base_amount 50, measure_unit `g`, 1 staple portion per unit) by a measure of 33
- **THEN** the item's quantity is set to 33 ÷ 50 = 0.66, so its consumed amount is 0.66 staple portions

#### Scenario: Millilitre measure sets the quantity
- **WHEN** a user adds `無糖豆漿/240mL` (base_amount 240, measure_unit `ml`, 1 meat portion per unit) by a measure of 120
- **THEN** the item's quantity is set to 120 ÷ 240 = 0.5, so its consumed amount is 0.5 meat portions

#### Scenario: Measure add rejected without a measure basis
- **WHEN** a user attempts to add `飯/1碗` (base_amount null) by a measure amount
- **THEN** the system rejects the request with a client error

#### Scenario: Measure and quantity are mutually exclusive
- **WHEN** a user adds a dictionary item supplying both a measure amount and a quantity
- **THEN** the system rejects the request with a client error

