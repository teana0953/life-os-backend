# Tasks

TDD throughout: write the failing test first, then the implementation. Run
`npm test` + `npm run typecheck` before finishing. Serial (each step depends on
the previous — schema → parse → domain → reseed).

## 1. Schema: measure_unit enum → text

- [x] 1.1 `src/shared/db/schema.ts`: drop the `foodMeasureUnit` pgEnum; change
      `food_item.measure_unit` and `meal_item.measure_unit` to `text("measure_unit")`
      (nullable). Keep `base_amount` as-is. Update any type imports of the enum.
- [x] 1.2 Generate a drizzle migration (enum column → text on BOTH columns,
      preserving existing `g`/`ml` values). **Verify/patch the generated SQL**:
      Postgres cannot auto-cast enum→text, so each column change MUST carry
      `... SET DATA TYPE text USING "measure_unit"::text` (drizzle-kit often omits
      the USING clause → migration fails to run). After both columns are text,
      `DROP TYPE "food_measure_unit"` (the enum created by
      `drizzle/0004_chubby_tomorrow_man.sql` is now orphaned). Existing g/ml
      values survive verbatim as text.
- [x] 1.3 **Widen every `"g"|"ml"` narrow type to `string`** (schema→text makes
      drizzle `$inferSelect.measureUnit` a `string|null`; these hardcoded unions
      don't import the enum so 1.1 won't catch them, and `npm run typecheck`
      (5.2) will fail without this): `src/contexts/health/domain/food-item.ts`
      (measureUnit field, ~L19), `src/contexts/health/domain/meal-entry.ts`
      (MealItem.measureUnit, ~L30), `src/contexts/health/domain/meal-repository.ts`
      (CreateMealItemInput.measureUnit, ~L22), and the `parseBaseMeasure` return
      type in `food-dictionary-seed.ts` (`unit: "g"|"ml"` → `string`). Confirm the
      `toDomain`/`toMealItem` repository mappers and `create-meal.ts` still typecheck.

## 2. Parse: generalize parseBaseMeasure with a quantifier whitelist

- [x] 2.1 Test first — `parseBaseMeasure`: quantifiers `櫻桃/9顆`→(9,'顆'),
      `飯/1碗`→(1,'碗'), `芭樂/1顆`→(1,'顆'), `星巴克拿鐵(大杯)/1杯`→(1,'杯'),
      `花枝/墨魚/3圈`→(3,'圈'), `熟麵/1碗(陽春麵…)`→(1,'碗'); g/ml normalization
      unchanged (`飯/50g`→(50,'g'), `無糖豆漿/240mL`→(240,'ml')); **null** edge
      cases: `馬鈴薯/3分之2碗`, `290mL/1瓶`, `養樂多(紅)/1罐`, `中華嫩豆腐/1盒`,
      `POP CORNERS/1份`, `熟肉/掌心大`, `地瓜/1個雞蛋大小`→(1,'個') [prefix match ok],
      `營養標示卡路里/60卡`.
- [x] 2.2 Implement — add a quantifier-whitelist pattern (個 顆 碗 片 杯 條 隻 根
      湯匙 球 圈 截 — only these 12, all present in the TSV; no speculative units)
      anchored `/\/\s*(\d+(?:\.\d+)?)\s*(unit)/`, tried after g then ml; return
      `{ amount, unit }` with the quantifier verbatim, g/克→'g', ml/mL/毫升/cc→'ml'.
      Keep both null when nothing matches.
- [x] 2.3 Update `SeedFoodItem.measureUnit` type `"g"|"ml"|null` → `string|null`;
      `seedRowToFoodItem` still spreads `measure?.unit ?? null` (both-or-null holds).

## 3. Domain / measureToQuantity

- [x] 3.1 Confirm/test `measureToQuantity(measure, baseAmount)` = measure ÷ baseAmount
      works for a household base (e.g. 18 ÷ 9 = 2); still throws
      `NullBaseMeasureError` when baseAmount is null. Update the `food-item.ts`
      both-null doc comment to say the unit is any string, not just g/ml.

## 4. Reseed + coverage counts

- [x] 4.1 `npm run seed:gen` (regenerate `food-dictionary-seed-data.ts` from the
      TSV — data file only, no TSV edit needed) then `npm run db:seed`.
- [x] 4.2 Record the new counts in the change (design.md coverage line): g / ml /
      quantifier-with-base / still-null / total 271. Add a test asserting the
      whitelist-hit vs still-null counts over the seed rows.

## 5. Spec / API surface

- [x] 5.1 Confirm `mealItemToJson` and food-item API responses emit `measure_unit`
      as a string (no enum narrowing anywhere). Add/confirm an API test: a
      household food (with a base) accepts a `measure` and computes quantity
      (no longer a blanket 400).
- [x] 5.2 `npm test` + `npm run typecheck` green.
