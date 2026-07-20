## 1. Schema + migration

- [ ] 1.1 In `shared/db/schema.ts` add a `foodMeasureUnit` pgEnum
      (`food_measure_unit`, values `'g' | 'ml'`). On `foodItem` replace
      `baseGrams: numeric("base_grams")` with `baseAmount: numeric("base_amount")`
      and `measureUnit: foodMeasureUnit("measure_unit")` (both nullable). Apply the
      same replacement on `mealItem`. → verify: `npm run typecheck` passes; no
      `base_grams` / `baseGrams` symbols remain in the schema.
- [ ] 1.2 Generate the Drizzle migration: create the `food_measure_unit` enum;
      on `food_item` and `meal_item` rename `base_grams` → `base_amount` and add
      `measure_unit`, backfilling `measure_unit = 'g'` where `base_amount` is not
      null (old gram semantics) and leaving it null where `base_amount` is null.
      → verify: migration files present; both-or-neither invariant preserved (no
      row has one of the two columns null and the other set).

## 2. Domain

- [ ] 2.1 In `domain/quantity.ts` rename `gramsToQuantity(grams, baseGrams)` to
      `measureToQuantity(measure, baseAmount)` (body unchanged:
      `measure / baseAmount`) and `NullBaseGramsError` to `NullBaseMeasureError`
      (thrown when `baseAmount` is null). Leave `scaleByQuantity` untouched.
- [ ] 2.2 In `domain/food-item.ts` replace `baseGrams: number | null` with
      `baseAmount: number | null` and `measureUnit: "g" | "ml" | null`, updating
      the doc comment. In `domain/meal-entry.ts` do the same on `MealItem`.
- [ ] 2.3 In `domain/meal-repository.ts` replace `baseGrams` on
      `CreateMealItemInput` with `baseAmount` + `measureUnit`, and rename
      `UpdateMealItemPatch.grams` to `measure`; update the doc comment to describe
      measure ÷ base_amount. → verify: `npm run typecheck` compiles the domain.
- [ ] 2.4 Update every reader of the renamed patch field —
      `application/update-meal-item.ts` (its `patch.grams` branch/validation →
      `patch.measure`) and any HTTP handler mapping the request — so no orphaned
      `grams` symbol remains. → verify: `npm run typecheck` (no `grams` references
      outside the enum/measure rename).

## 3. Seed parsing

- [ ] 3.1 In `adapters/seed/food-dictionary-seed.ts` replace `parseBaseGrams` /
      `BASE_GRAMS_PATTERN` with `parseBaseMeasure(name): { amount, unit } | null`:
      a gram token (`g` word-boundary or `克`) → `{ amount, unit: 'g' }`, a
      millilitre token (`ml` / `mL` / `毫升` / `cc`) → `{ amount, unit: 'ml' }`,
      household token → null; keep both patterns **anchored to the number right
      after `/`**. Update `SeedFoodItem` and `seedRowToFoodItem` to emit
      `baseAmount` + `measureUnit`; leave all other seed fields unchanged.
- [ ] 3.2 In `seedFoodDictionary` map `baseAmount` / `measureUnit` into the insert
      values (null when household). Regenerate the seed data so the 15 ml-unit rows get
      `base_amount` + `'ml'`, gram rows keep `'g'`, and 碗/杯/顆 rows stay null.
      → verify: seed unit tests (task 6.2) pass.

## 4. Application + repositories

- [ ] 4.1 In `application/create-meal.ts` rename the dict-item `grams` input to
      `measure`, call `measureToQuantity(item.measure, dictItem.baseAmount)`, and
      copy `baseAmount` + `measureUnit` onto the created item.
- [ ] 4.2 In `adapters/drizzle-meal-repository.ts` map `baseAmount` + `measureUnit`
      in `toMealItem` and `itemToRow`, and in `updateItem` use
      `patch.measure` with `measureToQuantity(patch.measure, baseAmount)`.
- [ ] 4.3 In `adapters/drizzle-food-dictionary-repository.ts` map `baseAmount` +
      `measureUnit` in `toDomain`. → verify: `npm run typecheck` passes for
      application + adapters.

## 5. HTTP

- [ ] 5.1 In `routes/meals.ts` rename the request field `grams` → `measure` on the
      create-item parser and the `PATCH /api/meal-items` handler (still `> 0` and
      mutually exclusive with `quantity`), replace `NullBaseGramsError` with
      `NullBaseMeasureError` in the 400 mapping, and change `mealItemToJson` to
      emit `base_amount` + `measure_unit` instead of `base_grams`.
- [ ] 5.2 In `routes/food-dictionary.ts` change `toJson` to emit `base_amount` +
      `measure_unit` instead of `base_grams`. → verify: HTTP tests (task 6.4) pass.

## 6. Tests

- [ ] 6.1 `domain/quantity.test.ts`: rename to `measureToQuantity`; keep the gram
      case (`33 / 50 ≈ 0.66`), add an ml case (`120 / 240 = 0.5`), and assert
      `NullBaseMeasureError` when `baseAmount` is null.
- [ ] 6.2 `adapters/seed/food-dictionary-seed.test.ts`: assert `measure_unit 'g'`
      for `/50g` and `/140克`, `'ml'` for an ml sample (`無糖豆漿/240mL`,
      `啤酒/100ml`), null for `/1碗`, `/1根`, `/1杯`; keep the brand-name-`克`
      guard; assert the both-or-neither invariant.
- [ ] 6.3 `application/meal.test.ts` + `application/food-dictionary.test.ts`:
      generalise the in-memory repo and fixtures to `baseAmount` + `measureUnit`;
      cover a dict-item `measure` add for a gram food and an ml food, and a
      `measure` on a household-unit food rejected with `NullBaseMeasureError`.
- [ ] 6.4 `adapters/http/meals.test.ts`: rename `grams` → `measure` in requests,
      add an ml conversion case, keep the mutually-exclusive-400 and
      no-base-measure-400 cases, and assert responses carry `base_amount` +
      `measure_unit`.

## 7. Verify

- [ ] 7.1 Run `npm test` (both Vitest projects) and `npm run typecheck`; confirm
      no `base_grams` / `baseGrams` / `gramsToQuantity` / `NullBaseGramsError`
      symbols remain anywhere (`grep`). → verify: all tests green, grep empty.
- [ ] 7.2 Run `openspec validate --strict generalize-food-measure-unit` → exit 0.
