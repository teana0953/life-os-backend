## MODIFIED Requirements

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

Each seeded item SHALL record a **stable seed key** identifying the seed row it
came from. The key SHALL NOT change when the item's name is later corrected, and
SHALL be absent for an item that did not come from the seed (an
administrator-created shared item, or a user's custom item). No two items SHALL
share the same seed key.

Re-running the seed SHALL preserve the shared catalog as it currently stands: it
SHALL insert only the rows whose **seed key** is not already present among the
existing shared items — so an item whose name an administrator has since corrected
is still recognized as already seeded — and SHALL NOT modify or remove any
existing shared item, so that administrator corrections and
administrator-created shared items survive. A destructive full refresh (discard
the shared catalog and reinsert every row) SHALL remain available only when
explicitly requested by the operator.

The seed key SHALL NOT be settable or modifiable through the API, and SHALL NOT
appear in the food item representation returned to clients.

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

#### Scenario: A renamed seeded item is not re-inserted
- **WHEN** an administrator corrects the name of a seeded item and the seed is then re-run
- **THEN** no item is inserted and the renamed item remains the only copy of that seed row

#### Scenario: Seeded items carry their key, other shared items do not
- **WHEN** the seed creates an item and an administrator separately creates a shared item
- **THEN** the seeded item carries a seed key and the administrator-created item carries none

#### Scenario: Seed key is not client-visible or client-settable
- **WHEN** a client reads a food item, or an administrator creates or edits one
- **THEN** the seed key is absent from the response and cannot be supplied or changed by the request
