## MODIFIED Requirements

### Requirement: Food dictionary catalog

The system SHALL provide a catalog of food items. Each item SHALL be identified
by a human-readable name that includes its household-unit measure (e.g.
`飯/1碗`, `熟肉(雞豬牛羊魚)/30g`, `無糖豆漿/240mL`) and SHALL persist, following the
two-axis model owned by `diet-tracking`, BOTH:

- atomic nutrients `{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }` — the
  authority for calorie and nutrient totals; and
- food-group portion attribution `{ staple, meat, fruit, veg }` — the
  categorization axis.

The portion attribution SHALL be stored, NOT derived from nutrients, because the
food-group assignment (e.g. staple-carb vs fruit-carb) is human knowledge and is
not recoverable from grams. Each item MAY also carry a **measure basis** for
direct-amount logging by `diet-tracking`: `base_amount` — the amount of one
dictionary unit — together with `measure_unit` — the unit that amount is in,
either `g` (grams) or `ml` (millilitres). The two SHALL be consistently present
together (a directly-measurable food) or consistently null together (a
household-unit food whose unit has no defined gram or millilitre weight); no item
SHALL carry one without the other. When present, `measure_unit` SHALL be exposed
so a client can label the amount as 公克 or 毫升 and convert an entered measure to
a quantity via `base_amount`.

#### Scenario: Item exposes both stored axes
- **WHEN** a client reads a food item from the dictionary
- **THEN** the response includes both its atomic nutrients and its stored food-group portion attribution

#### Scenario: Item may carry a measure basis
- **WHEN** a client reads a food item whose unit is a gram or millilitre amount
- **THEN** the response includes its `base_amount` and its `measure_unit` (`g` or `ml`)

#### Scenario: Household-unit item carries no measure basis
- **WHEN** a client reads a food item whose unit is a household measure (e.g. `飯/1碗`)
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
`measure_unit`) for rows whose unit token is a bare measure amount: a gram unit
(`g` or `克`, e.g. `飯/50g` → `50` + `g`) and a millilitre unit (`ml`, `mL`,
`毫升`, or `cc`, e.g. `無糖豆漿/240mL` → `240` + `ml`), leaving both null for
household-unit rows (e.g. `飯/1碗`, `香蕉/1根`). The measure token SHALL be
anchored to the amount immediately after the name's `/`, so a measure-looking
substring inside a brand name is not mistaken for the unit.

#### Scenario: Seed stores both axes
- **WHEN** the seed loads a row recorded as 主食 1 份
- **THEN** the created food item stores 1 staple portion and carries approximately 15 g carbohydrate in its atomic nutrients

#### Scenario: Seed backfills a gram measure basis
- **WHEN** the seed loads the row `飯/50g`
- **THEN** the created food item's base_amount is 50 and its measure_unit is `g`

#### Scenario: Seed backfills a millilitre measure basis
- **WHEN** the seed loads the row `無糖豆漿/240mL`
- **THEN** the created food item's base_amount is 240 and its measure_unit is `ml`

#### Scenario: Household-unit row has no measure basis
- **WHEN** the seed loads the row `飯/1碗`
- **THEN** the created food item's base_amount and measure_unit are both null
