## RENAMED Requirements

- FROM: `### Requirement: Gram-based dictionary logging`
- TO: `### Requirement: Measure-based logging (g or ml)`

## MODIFIED Requirements

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
