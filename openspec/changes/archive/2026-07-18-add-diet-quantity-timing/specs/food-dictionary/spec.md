## MODIFIED Requirements

### Requirement: Food dictionary catalog

The system SHALL provide a catalog of food items. Each item SHALL be identified
by a human-readable name that includes its household-unit measure (e.g.
`飯/1碗`, `熟肉(雞豬牛羊魚)/30g`) and SHALL persist, following the two-axis
model owned by `diet-tracking`, BOTH:

- atomic nutrients `{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }` — the
  authority for calorie and nutrient totals; and
- food-group portion attribution `{ staple, meat, fruit, veg }` — the
  categorization axis.

The portion attribution SHALL be stored, NOT derived from nutrients, because the
food-group assignment (e.g. staple-carb vs fruit-carb) is human knowledge and is
not recoverable from grams. Each item MAY also carry an optional `base_grams` —
the gram weight of one dictionary unit — used by `diet-tracking` for gram-based
logging; it SHALL be null when the item's unit has no defined gram weight.

#### Scenario: Item exposes both stored axes
- **WHEN** a client reads a food item from the dictionary
- **THEN** the response includes both its atomic nutrients and its stored food-group portion attribution

#### Scenario: Item may carry base grams
- **WHEN** a client reads a food item whose unit is a gram amount
- **THEN** the response includes its `base_grams`

### Requirement: Seeded shared catalog

The system SHALL seed the shared dictionary from the user's 271-row
food→portion table. Each seeded item SHALL store BOTH axes: the row's given
portions as its food-group attribution, and atomic nutrients derived from those
portions via the single conversion rule owned by `diet-tracking` (staple/fruit
portion → 15 g carbohydrate, meat portion → 7 g protein, vegetable portion → 5 g
carbohydrate). The seed applies no fat estimate, so seeded nutrients — meat kcal
in particular — are approximate and MAY be corrected per food item later; a
seeded and a manually-logged meat portion therefore carry the same derived
nutrients. The seed SHALL also backfill `base_grams` for rows whose unit is a
bare gram amount (e.g. `飯/50g` → 50), leaving it null for household-unit rows
(e.g. `飯/1碗`, `香蕉/1根`).

#### Scenario: Seed stores both axes
- **WHEN** the seed loads a row recorded as 主食 1 份
- **THEN** the created food item stores 1 staple portion and carries approximately 15 g carbohydrate in its atomic nutrients

#### Scenario: Seed backfills base grams from a gram unit
- **WHEN** the seed loads the row `飯/50g`
- **THEN** the created food item's base_grams is 50

#### Scenario: Household-unit row has no base grams
- **WHEN** the seed loads the row `飯/1碗`
- **THEN** the created food item's base_grams is null
