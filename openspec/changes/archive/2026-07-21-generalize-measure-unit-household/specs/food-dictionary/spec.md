## MODIFIED Requirements

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
