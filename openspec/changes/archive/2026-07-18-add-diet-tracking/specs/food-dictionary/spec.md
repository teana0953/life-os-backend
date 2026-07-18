## ADDED Requirements

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
not recoverable from grams.

#### Scenario: Item exposes both stored axes
- **WHEN** a client reads a food item from the dictionary
- **THEN** the response includes both its atomic nutrients and its stored food-group portion attribution

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
nutrients.

#### Scenario: Seed stores both axes
- **WHEN** the seed loads a row recorded as 主食 1 份
- **THEN** the created food item stores 1 staple portion and carries approximately 15 g carbohydrate in its atomic nutrients

### Requirement: User-custom food items

The system SHALL let an authenticated user create custom food items owned by
that user. A custom item SHALL be visible only to its owner, while seeded
(shared) items SHALL be visible to all users. A user's search SHALL return both
shared items and that user's own custom items.

#### Scenario: Custom item is private to owner
- **WHEN** user A creates a custom food item
- **THEN** the item appears in user A's dictionary search and does not appear in user B's search

### Requirement: Favorite food items

The system SHALL let an authenticated user mark and unmark dictionary items as
favorites, and SHALL let the user list their favorites.

#### Scenario: Mark and list favorite
- **WHEN** a user marks an item as a favorite and then lists favorites
- **THEN** the item appears in that user's favorites list

#### Scenario: Unmark favorite
- **WHEN** a user unmarks a previously favorited item and then lists favorites
- **THEN** the item no longer appears in that user's favorites list
