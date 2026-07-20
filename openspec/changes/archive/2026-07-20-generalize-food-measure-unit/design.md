# Design — generalize-food-measure-unit

Generalises the food dictionary's "gram basis" into a **base amount + measure
unit (g or ml)** so millilitre-priced drinks log by their volume exactly as
gram-priced foods log by their weight, while household-unit foods keep no
measure. Decisions below are labelled G1…G7 and double as the acceptance basis.

## G1. `base_amount` + `measure_unit`, with a both-or-neither invariant

`food_item.base_grams` (numeric, nullable) is replaced by two columns:

- `base_amount` (numeric, nullable) — the amount of one dictionary unit expressed
  in the food's measure unit (e.g. 50 for `飯/50g`, 240 for `無糖豆漿/240mL`).
- `measure_unit` (pgEnum `'g' | 'ml'`, nullable) — which unit `base_amount` is in.

**Invariant:** `base_amount` and `measure_unit` are either **both present** (a
directly-measurable food — weight or volume) or **both null** (a household-unit
food such as 碗 / 杯 / 顆 / 根, whose unit has no defined gram or millilitre
weight). No row has one set and the other null. This is the direct generalisation
of the old rule "`base_grams` null ⇔ household unit".

Why an enum, not free text: the unit is a closed set of exactly two values, and
the schema already models a closed set this way (`food_entry_source` pgEnum). A
DB-level enum keeps out `'grams'`, `'mL'`, `'oz'`, etc. at the source and gives
Drizzle a precise TypeScript union (`"g" | "ml"`) for free; a `text` column would
push that validation into application code for no benefit.

`meal_item` carries the same two columns (replacing its `base_grams`), copied
from the dictionary item when the item is added, so a per-item measure edit
(`PATCH /api/meal-items`) can convert an amount without re-reading the dictionary.

**Acceptance:** a seeded gram food exposes `{ base_amount, measure_unit: 'g' }`; a
seeded ml food exposes `{ base_amount, measure_unit: 'ml' }`; a household-unit
food exposes `{ base_amount: null, measure_unit: null }`. No food exposes exactly
one of the two.

## G2. Seed parsing recognises g **and** ml

`parseBaseGrams` becomes `parseBaseMeasure(name): { amount, unit } | null`,
returning the base amount **and** its unit from the unit token after the row
name's `/`:

- gram token — `g` (word-boundary) or `克` → `{ amount, unit: 'g' }`
- millilitre token — `ml` / `mL` / `毫升` / `cc` → `{ amount, unit: 'ml' }`
- household token (碗 / 杯 / 顆 / 根 / 個 / 湯匙 / 瓶 …) → `null`

Both patterns stay **anchored to the number immediately after `/`**, exactly as
the current gram pattern is, so a unit-looking substring inside a brand name
before the `/` is never mistaken for the unit. This matters for the source table:
rows like `喝的桂格燕麥飲290mL/1瓶` contain `290mL` in the *name* but their unit
token is `/1瓶` (household) → they stay null; only rows whose unit token itself is
a volume (e.g. `無糖豆漿/240mL`, `啤酒/100ml`, `muji 草莓紅茶罐裝/ 315ml`) parse to
`'ml'`. There are 15 genuinely ml-unit rows (the measure is after the slash, e.g. `/240mL`). Names that merely contain "mL" while their unit is a household count (e.g. `喝的桂格燕麥飲290mL/1瓶`) stay null — 3 such trap rows are NOT counted.

`seedRowToFoodItem` returns `base_amount` + `measure_unit` in place of
`base_grams`; every other seed field (portions, derived nutrients, the fruit
`sugar_g` rule) is unchanged. Reseeding is a data-only regeneration — the ml rows
gain `base_amount` + `'ml'`, gram rows keep `'g'`, household rows stay null.

**Acceptance:** parsing `無糖豆漿/240mL` yields `{ amount: 240, unit: 'ml' }`;
`飯/50g` and `雞胸肉水餃/140克` yield `unit: 'g'`; `飯/1碗` and `香蕉/1根` yield
null; `星巴克拿鐵(大杯)/1杯` (a 克-free household unit) stays null.

## G3. `measure ÷ base_amount` conversion (unit-agnostic)

`quantity.ts` renames `gramsToQuantity(grams, baseGrams)` to
`measureToQuantity(measure, baseAmount)`; the body is unchanged
(`return measure / baseAmount`), because the arithmetic never depended on the
unit — a gram amount over a gram base and a millilitre amount over a millilitre
base both yield a dimensionless multiplier. `NullBaseGramsError` becomes
`NullBaseMeasureError`, thrown when `baseAmount` is null (a measure amount was
given for a household-unit food). `scaleByQuantity` is untouched.

The measure supplied by a caller is always interpreted in **that food's**
`measure_unit`; the system does not convert between g and ml (they are not
interchangeable), it only divides like-by-like. Mixing units is impossible by
construction because a food has exactly one measure unit.

**Acceptance:** `measureToQuantity(33, 50) ≈ 0.66` (grams over a gram base);
`measureToQuantity(120, 240) = 0.5` (millilitres over a millilitre base);
`measureToQuantity(33, null)` throws `NullBaseMeasureError`.

## G4. API: `measure` request field, `base_amount` + `measure_unit` in responses

- **Request.** The dict-item `grams` field on `POST /api/meals` items and the
  `grams` field on `PATCH /api/meal-items` become `measure` — a finite number
  `> 0` in the item's own `measure_unit`, **mutually exclusive with `quantity`**.
  Supplying both is a client error; supplying `measure` for a food whose
  `base_amount` is null is a client error (`NullBaseMeasureError` → 400). When
  `measure` is given, `quantity = measure ÷ base_amount` and the per-unit
  portions/nutrients are left unchanged (Model Y, G5).
- **Response.** Everywhere the JSON exposed `base_grams` — the food-item and
  search JSON (`food-dictionary.ts`), and the meal-item JSON used by
  `get-day-meals` and the create/update handlers (`meals.ts`) — it now exposes
  `base_amount` and `measure_unit`. The client uses `measure_unit` to label the
  amount 公克 or 毫升 and `base_amount` to convert between an entered measure and a
  quantity. Owner-scope and every other field are unchanged.

**Acceptance:** posting a dict item with `{ measure: 120 }` for `無糖豆漿/240mL`
creates an item with `quantity = 0.5`; posting `{ measure, quantity }` together,
or `{ measure }` for a household-unit food, returns 400; a food-item response
includes `base_amount` and `measure_unit`.

## G5. Two-axis Model Y is unchanged

`measure` is purely an alternate way to compute the `quantity` multiplier; it is
never persisted as a consumed amount. `meal_item` still stores per-unit
`{ staple, meat, fruit, veg }` + per-unit `{ carb_g … kcal }` + `quantity`, and
the consumed amount stays `per-unit × quantity`, derived on read. The only
Model-Y-adjacent addition is that the per-item `base_amount` + `measure_unit`
(copied from the dictionary item) let a later `measure` edit recompute `quantity`
without the dictionary. Daily targets and totals are unaffected.

## G6. Migration: rename the column, add the unit

Because no production data exists and no other code owns these columns, the
migration is a straight column change rather than a data backfill:

- `food_item`: rename `base_grams` → `base_amount`; add `measure_unit`
  (`food_measure_unit` pgEnum `'g' | 'ml'`, nullable). Existing gram-priced rows
  get `measure_unit = 'g'` (the old semantics: any non-null `base_grams` was a
  gram weight); rows with null `base_amount` keep `measure_unit` null.
- `meal_item`: the same rename + add.
- Create the `food_measure_unit` enum type.

In practice the dictionary is reseeded from source after the migration, so the
seed (G2) is the authoritative writer of `measure_unit`; the "existing gram rows →
'g'" backfill only matters for any rows written before a reseed and preserves the
both-or-neither invariant (G1) regardless.

## G7. Test strategy (Vitest)

Generalise the existing gram-focused tests to measure and add ml coverage. Three
food classes recur: **gram food** (`飯/50g`), **ml food** (`無糖豆漿/240mL`),
**household-unit food** (`飯/1碗`).

- **Domain (`quantity.test.ts`)** — `measureToQuantity` for a gram basis
  (`33 / 50 ≈ 0.66`) and an ml basis (`120 / 240 = 0.5`); `NullBaseMeasureError`
  when `baseAmount` is null. `scaleByQuantity` unchanged.
- **Seed (`food-dictionary-seed.test.ts`)** — `seedRowToFoodItem` yields
  `measure_unit 'g'` for `/50g` and `/140克`, `'ml'` for `/240mL` and `/100ml`
  (an ml sample), null for `/1碗`, `/1根`, `/1杯`; brand-name `克`/`ml` before the
  `/` is not mistaken for a unit; the both-or-neither invariant holds.
- **Application (`meal.test.ts`)** — creating a dict item by `measure` sets
  `quantity = measure ÷ base_amount` for a gram food and an ml food, leaving
  per-unit values unchanged; a `measure` on a household-unit food throws
  `NullBaseMeasureError`; a `measure` update on `PATCH` behaves the same.
- **HTTP (`meals.test.ts`, `food-dictionary.test.ts`)** — `POST /api/meals` with
  `measure` converts via `base_amount`; `measure` + `quantity` together → 400;
  `measure` on a household-unit food → 400; responses carry `base_amount` +
  `measure_unit`.

Run `npm test` (both Vitest projects) and `npm run typecheck`.
