## Why

The food dictionary already lets a user log a gram-priced item by its weight:
`飯/50g` carries `base_grams = 50`, so entering 33 g sets the item's quantity to
`33 ÷ 50` and its consumed portions/nutrients follow. But the same table holds
**millilitre-priced** drinks — 15 rows such as `無糖豆漿/240mL`, `啤酒/100ml`,
`燕麥奶/250ml`, `全脂牛奶/120mL` — and for those `base_grams` is null, so the user
cannot enter "200 mL of soy milk" the way they enter "33 g of rice". They are
forced to reverse a millilitre amount into a fractional unit multiple by hand.

`base_grams` also hard-codes grams into the API and UI: the column name, the
`grams` request field, and the `base_grams` response field all assume weight, so
a client cannot correctly label a drink's amount as millilitres. The user chose
to generalise the "gram basis" into a **base amount + measure unit (g or ml)**
rather than bolt on a parallel millilitre path, so one code path serves both
kinds of directly-measurable food and household-unit foods (碗/杯/顆) keep no
measure at all.

This is a breaking API change: the request field `grams` becomes `measure` and
the response field `base_grams` becomes `base_amount` + `measure_unit`. That is
acceptable now — no production data exists to migrate, and the only client
(frontend PR③) ships against the new shape.

## What Changes

- **Schema.** `food_item.base_grams` (numeric, nullable) becomes
  `base_amount` (numeric, nullable) **plus** `measure_unit` (a pgEnum `'g' | 'ml'`,
  nullable). Invariant: the two are consistently present together (a
  directly-measurable food) or consistently null together (a household-unit food
  such as 碗/杯/顆). `meal_item` gets the same two columns, replacing its
  `base_grams` (copied from the dictionary item at add time for per-item measure
  editing).
- **Seed parsing.** `parseBaseGrams` becomes `parseBaseMeasure`: it recognises a
  gram unit (`g` / `克`) → `{ amount, unit: 'g' }` **and** a millilitre unit
  (`ml` / `mL` / `毫升` / `cc`) → `{ amount, unit: 'ml' }`; a household-unit token
  yields null. Reseeding gives the 15 ml-unit rows a `base_amount` + `'ml'`, keeps
  gram rows at `'g'`, and leaves 碗/杯/顆 rows null. No other seed field changes.
- **Domain conversion.** `quantity.ts`'s `gramsToQuantity(grams, baseGrams)`
  becomes `measureToQuantity(measure, baseAmount)` (same `measure ÷ base_amount`
  math, unit-agnostic); `NullBaseGramsError` becomes `NullBaseMeasureError`.
- **API (breaking).** On `POST /api/meals` items and `PATCH /api/meal-items`, the
  `grams` field becomes `measure` — an amount in the item's own `measure_unit`,
  mutually exclusive with `quantity` and required to be `> 0`. Responses
  (`get-day-meals` item JSON, food-item and search JSON) replace `base_grams`
  with `base_amount` + `measure_unit`, so the client can label the amount 公克 or
  毫升 and compute against the right basis. Owner-scope and all other validation
  are unchanged.
- **Model Y unchanged.** `meal_item` still stores per-unit portions + nutrients +
  `quantity`; `measure` is only another input path for computing `quantity`
  (`measure ÷ base_amount`), never a stored consumed amount.
- **Rewire / cleanup.** Every `base_grams` / `grams` touchpoint across domain,
  use cases, repositories, HTTP, and tests is generalised to the measure form
  with no orphaned symbols. `daily_target` is untouched.

## Impact

- **Affected specs**:
  - `diet-tracking` — RENAME + MODIFY "Gram-based dictionary logging" to
    "Measure-based logging (g or ml)"; MODIFY "Update a food entry" and "Meal
    creation with multiple items" to speak of a measure amount rather than grams.
  - `food-dictionary` — MODIFY "Food dictionary catalog" (expose `base_amount` +
    `measure_unit`) and "Seeded shared catalog" (backfill measure for gram **and**
    millilitre units).
- **Affected code**:
  - `shared/db/schema.ts` + a Drizzle migration: rename `food_item.base_grams` →
    `base_amount`, add `measure_unit` enum; same on `meal_item`.
  - `contexts/health/domain`: `FoodItem` and `MealItem` (`baseGrams` → `baseAmount`
    + `measureUnit`); `quantity.ts` (`measureToQuantity`, `NullBaseMeasureError`);
    `meal-repository.ts` (`CreateMealItemInput`, `UpdateMealItemPatch.grams` →
    `measure`).
  - `contexts/health/application`: `create-meal.ts` (dict-item `measure` path).
  - `contexts/health/adapters`: `drizzle-meal-repository.ts`,
    `drizzle-food-dictionary-repository.ts`, `seed/food-dictionary-seed.ts`
    (`parseBaseMeasure`) + regenerated seed data.
  - `adapters/http`: `routes/meals.ts` and `routes/food-dictionary.ts`
    (`measure` field, `base_amount` + `measure_unit` responses,
    `NullBaseMeasureError` → 400).
  - Tests: `quantity`, `seed`, `meal`, `food-dictionary`, and HTTP `meals` tests
    generalised to measure, plus new ml coverage.
