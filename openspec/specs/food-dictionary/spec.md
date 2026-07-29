# food-dictionary Specification

## Purpose
TBD - created by archiving change add-diet-tracking. Update Purpose after archive.
## Requirements
### Requirement: Food dictionary catalog

The system SHALL provide a catalog of food items. Each item SHALL be identified
by a human-readable name that includes its unit measure (e.g. `飯/1碗`,
`櫻桃/9顆`, `熟肉(雞豬牛羊魚)/30g`, `無糖豆漿/240mL`) and SHALL persist, following the
two-axis model owned by `diet-tracking`, BOTH:

- atomic nutrients `{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }` — the
  authority for calorie and nutrient totals; and
- food-group portion attribution `{ staple, meat, fruit, veg }` — the
  categorization axis.

The portion attribution SHALL be stored, NOT derived from nutrients, because the
food-group assignment (e.g. staple-carb vs fruit-carb) is human knowledge and is
not recoverable from grams. Each item MAY also carry a **measure basis** for
direct-amount logging by `diet-tracking`: `base_amount` — the amount of one
dictionary unit — together with `measure_unit` — the unit that amount is in.
`measure_unit` is an open string: `g` (grams), `ml` (millilitres), or any
countable household quantifier word (e.g. `顆`, `碗`, `杯`, `片`, `個`). The two
SHALL be consistently present together (a food whose unit carries a definite
amount) or consistently null together (a food whose unit has no structured
amount — a fraction, a vague size, a packaging count, or `份`); no item SHALL
carry one without the other. When present, `measure_unit` SHALL be exposed so a
client can label the amount in that unit and convert an entered measure to a
quantity via `base_amount`.

#### Scenario: Item exposes both stored axes
- **WHEN** a client reads a food item from the dictionary
- **THEN** the response includes both its atomic nutrients and its stored food-group portion attribution

#### Scenario: Item may carry a measure basis
- **WHEN** a client reads a food item whose unit is a gram, millilitre, or countable household amount
- **THEN** the response includes its `base_amount` and its `measure_unit` (e.g. `g`, `ml`, or `顆`)

#### Scenario: Item without a structured amount carries no measure basis
- **WHEN** a client reads a food item whose unit has no structured amount (e.g. `熟肉/掌心大`, `POP CORNERS/1份`)
- **THEN** both its `base_amount` and its `measure_unit` are null

### Requirement: Dictionary search

The system SHALL let an authenticated user search the dictionary by a
case-insensitive substring of the item name and SHALL return the matching
items.

#### Scenario: Substring match
- **WHEN** an authenticated user searches with a name substring that occurs in one or more item names
- **THEN** the system returns those items and excludes non-matching items

#### Scenario: No match
- **WHEN** an authenticated user searches with a substring that matches no item name
- **THEN** the system returns an empty result set

### Requirement: Seeded shared catalog

The system SHALL seed the shared dictionary from the user's 271-row
food→portion table. Each seeded item SHALL store BOTH axes: the row's given
portions as its food-group attribution, and atomic nutrients derived from those
portions via the single conversion rule owned by `diet-tracking` (staple/fruit
portion → 15 g carbohydrate, meat portion → 7 g protein, vegetable portion → 5 g
carbohydrate). The seed applies no fat estimate, so seeded nutrients — meat kcal
in particular — are approximate and MAY be corrected per food item later; a
seeded and a manually-logged meat portion therefore carry the same derived
nutrients. The seed SHALL also backfill the **measure basis** (`base_amount` +
`measure_unit`) from the row name's unit token, anchored to the number
immediately after the name's `/` and the unit word immediately after that
number, so a measure-looking substring elsewhere in the name is never mistaken
for the unit. The recognized units are: grams (`g` or `克`, normalized to `g`),
millilitres (`ml`, `mL`, `毫升`, or `cc`, normalized to `ml`), and a whitelist of
countable household quantifiers (顆, 碗, 杯, 片, 個, 條, 隻, 根, 湯匙, 球, 圈, 截
— kept verbatim). A row whose token does not match — a
fraction (`3分之2碗`), a packaging count (`290mL/1瓶`, `/1盒`, `/1包`, `/1罐`), a
vague size (`掌心大`, `2指寬`), `份`, or `卡` — SHALL leave both null.

Re-running the seed SHALL preserve the shared catalog as it currently stands: it
SHALL insert only the rows whose names are not already present **among the
existing shared items** (a user's private custom item with the same name does not
suppress a seed row) and SHALL NOT modify or remove any existing shared item, so
that administrator corrections and administrator-created shared items survive. A destructive full refresh (discard
the shared catalog and reinsert every row) SHALL remain available only when
explicitly requested by the operator.

#### Scenario: Seed stores both axes
- **WHEN** the seed loads a row recorded as 主食 1 份
- **THEN** the created food item stores 1 staple portion and carries approximately 15 g carbohydrate in its atomic nutrients

#### Scenario: Seed backfills a gram measure basis
- **WHEN** the seed loads the row `飯/50g`
- **THEN** the created food item's base_amount is 50 and its measure_unit is `g`

#### Scenario: Seed backfills a millilitre measure basis
- **WHEN** the seed loads the row `無糖豆漿/240mL`
- **THEN** the created food item's base_amount is 240 and its measure_unit is `ml`

#### Scenario: Seed backfills a countable household quantifier basis
- **WHEN** the seed loads the row `櫻桃/9顆`
- **THEN** the created food item's base_amount is 9 and its measure_unit is `顆`

#### Scenario: Seed leaves an ambiguous unit token null
- **WHEN** the seed loads a row whose token is a fraction, packaging count, vague size, or `份` (e.g. `馬鈴薯/3分之2碗`, `養樂多(紅)/1罐`, `熟肉/掌心大`)
- **THEN** the created food item's base_amount and measure_unit are both null

#### Scenario: Re-running the seed keeps administrator changes
- **WHEN** the seed is re-run after an administrator has corrected a seeded item and created an extra shared item
- **THEN** the correction and the extra item are still present afterwards, and no shared item is duplicated

#### Scenario: Explicit full refresh still replaces the catalog
- **WHEN** the operator explicitly requests a destructive refresh
- **THEN** the shared catalog is discarded and reinserted from the seed rows

### Requirement: User-custom food items

The system SHALL let an authenticated user create custom food items owned by
that user. A custom item SHALL be visible only to its owner, while seeded
(shared) items SHALL be visible to all users. A user's search SHALL return both
shared items and that user's own custom items.

#### Scenario: Custom item is private to owner
- **WHEN** user A creates a custom food item
- **THEN** the item appears in user A's dictionary search and does not appear in user B's search

#### Scenario: Another user cannot reach a private custom item by id
- **WHEN** user B attempts to log or favorite user A's custom item by its id
- **THEN** the system treats the item as not found for user B and neither logs nor favorites it

### Requirement: Favorite food items

The system SHALL let an authenticated user mark and unmark dictionary items as
favorites, and SHALL let the user list their favorites.

#### Scenario: Mark and list favorite
- **WHEN** a user marks an item as a favorite and then lists favorites
- **THEN** the item appears in that user's favorites list

#### Scenario: Unmark favorite
- **WHEN** a user unmarks a previously favorited item and then lists favorites
- **THEN** the item no longer appears in that user's favorites list

### Requirement: Administrator-created shared items

The system SHALL let an administrator create a shared food item — one with no
owner, visible to every user — carrying the same two stored axes as any
dictionary item (atomic nutrients and food-group portion attribution) and,
optionally, a measure basis (`base_amount` + `measure_unit`). A non-administrator
SHALL NOT be able to create a shared item; the existing user-facing creation
endpoint continues to produce owner-private custom items only.

#### Scenario: Administrator creates a shared item
- **WHEN** an administrator creates a shared food item
- **THEN** the item is created with no owner and appears in another user's dictionary search

#### Scenario: Non-administrator is refused
- **WHEN** an authenticated non-administrator attempts to create a shared food item
- **THEN** the system refuses the request as forbidden and creates no item

### Requirement: Administrator editing of shared items

The system SHALL let an administrator correct the fields of an existing shared
food item: its name, its atomic nutrients, its food-group portion attribution,
and its measure basis. The edit SHALL be partial — only the fields supplied are
changed, and every unsupplied field keeps its stored value. An item's identity,
ownership, and creation time SHALL NOT be editable. A request that supplies no
editable field SHALL be rejected as invalid.

Only shared items are editable this way. A target that does not exist, and a
target that is some user's private custom item, SHALL be reported identically as
not found, so that the existence of another user's private item is not
disclosed. A non-administrator SHALL be refused regardless of the target.

#### Scenario: Partial edit changes only the supplied fields
- **WHEN** an administrator edits a shared item supplying a new name and a new carbohydrate value
- **THEN** the item's name and carbohydrate value change and all its other fields keep their previous values

#### Scenario: Empty edit is rejected
- **WHEN** an administrator sends an edit that supplies no editable field
- **THEN** the system rejects the request as invalid and the item is unchanged

#### Scenario: Another user's custom item is not editable
- **WHEN** an administrator attempts to edit a food item owned by a user
- **THEN** the system reports the item as not found and the item is unchanged

#### Scenario: Unknown item
- **WHEN** an administrator attempts to edit a food item id that does not exist
- **THEN** the system reports the item as not found

#### Scenario: Malformed item id
- **WHEN** an administrator attempts to edit a food item id that is not a well-formed identifier
- **THEN** the system reports the item as not found rather than failing internally

#### Scenario: Non-administrator is refused
- **WHEN** an authenticated non-administrator attempts to edit a shared item
- **THEN** the system refuses the request as forbidden and the item is unchanged

#### Scenario: Unauthenticated request is refused before authorization
- **WHEN** a request without valid credentials reaches an administrator food-dictionary endpoint
- **THEN** the system refuses it as unauthenticated

### Requirement: Measure basis invariant enforced on write

Every write to a food item's measure basis SHALL preserve the catalog invariant
that `base_amount` and `measure_unit` are consistently present together or
consistently null together. The invariant SHALL be evaluated against the item's
state **after** the write is applied, so a partial edit that would leave one set
and the other null SHALL be rejected as invalid and SHALL change nothing.

#### Scenario: Edit that would strand a measure unit is rejected
- **WHEN** an administrator edits an item that has both a base amount and a measure unit, clearing only the base amount
- **THEN** the system rejects the request as invalid and the item keeps both stored values

#### Scenario: Edit setting both parts together is accepted
- **WHEN** an administrator edits an item that has no measure basis, supplying both a base amount and a measure unit
- **THEN** the item stores both values

#### Scenario: Edit clearing both parts together is accepted
- **WHEN** an administrator edits an item that has a measure basis, clearing both the base amount and the measure unit in one request
- **THEN** the item stores neither value

#### Scenario: Creating a shared item with only one part is rejected
- **WHEN** an administrator creates a shared item supplying a measure unit without a base amount
- **THEN** the system rejects the request as invalid and creates no item

### Requirement: Dictionary edits do not rewrite logged history

Because a logged meal item stores its own copy of the nutrients and portions it
was logged with, an administrator's correction to a dictionary item SHALL NOT
change any previously logged meal.

#### Scenario: Logged meal is unaffected by a later dictionary correction
- **WHEN** an administrator edits the nutrients of a shared item that an existing meal was logged from
- **THEN** that meal's stored nutrients and portions are unchanged

