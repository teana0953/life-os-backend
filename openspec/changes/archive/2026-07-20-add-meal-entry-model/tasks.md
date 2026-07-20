## 1. Schema + migration

- [ ] 1.1 In `shared/db/schema.ts` add `mealEntry` (`id`, `userId` FK `users`,
      `day` date, `meal` text, `time` timestamptz, `createdAt`;
      `unique(userId, day, meal)`) and `mealItem` (`id`, `mealEntryId` FK
      `meal_entry` ON DELETE CASCADE, `foodItemId` uuid nullable FK `food_item`
      **ON DELETE SET NULL**, `name` text nullable, `photoRef` text nullable,
      `source` enum manual/ai_photo/dict, `unclassified` bool default false, and
      the two-axis **per-unit** store — per-unit portion columns
      `staple/meat/fruit/veg` and per-unit nutrient columns
      `carbG/proteinG/fatG/sugarG/fiberG/kcal` (the amount for `quantity = 1`) —
      plus `quantity` numeric (multiplier, default `"1"`), `baseGrams` numeric
      nullable, `createdAt`. The consumed amount (per-unit × quantity) is derived
      on read, never a stored column. Reuse the existing `foodEntrySource` pg enum
      for `mealItem.source`. Remove the `foodEntry` export.
- [ ] 1.2 Generate the Drizzle migration: create `meal_entry` + `meal_item`
      (with the unique key + `meal_item → meal_entry` `ON DELETE CASCADE` and
      `meal_item.food_item_id → food_item` `ON DELETE SET NULL`), drop
      `food_entry`. → verify: migration files present, the two FK delete actions
      are CASCADE and SET NULL respectively.

## 2. Domain

- [ ] 2.1 Add `MealEntry` (`id, userId, day, meal, time, items: MealItem[]`) and
      `MealItem` (`id, mealEntryId, foodItemId|null, name|null, photoRef|null,
      source, unclassified, per-unit `staple/meat/fruit/veg`, per-unit
      `carb_g…kcal`, `quantity`, `baseGrams|null`) entities under
      `contexts/health/domain`. Stored values are per-unit; the consumed amount
      (per-unit × quantity) is derived on read, not a field.
- [ ] 2.2 Add the `MealRepository` port: `upsertMealWithItems(input)` (create or
      reuse `(userId, day, meal)`, set `time` on create, append items);
      `listMealsByDay(userId, day)` → meals-with-items (per-unit + quantity);
      `listLoggedDays(userId, month)` → distinct days ascending;
      `updateMealTime(userId, mealId, time)`; `deleteMeal(userId, mealId)`
      (cascade); `updateItem(userId, itemId, patch)` — per Model Y: by `quantity`
      → set `quantity` only; by grams → set `quantity = grams ÷ baseGrams`; by
      per-unit portions → set the per-unit portion columns and recompute per-unit
      nutrients (mark classified); the per-unit values are never rescaled when
      only `quantity` changes; owner-scoped via the item's parent meal;
      `deleteItem(userId, itemId)`. All owner-scoped (foreign user → null / false
      / not found).
- [ ] 2.3 Remove `food-entry.ts` and `diet-log-repository.ts` (`FoodEntry`,
      `DietLogRepository`, `CreateFoodEntryInput`, `UpdateFoodEntryPatch`). Keep
      `conversion.ts` and `quantity.ts` unchanged.

## 3. Application (TDD, in-memory repo)

- [ ] 3.1 `createMeal` use case: upsert the meal for `(user, day, meal)` and
      write all `items[]`; each item stores **per-unit** values + `quantity` (never
      pre-multiplied) — dictionary item (`foodItemId` + optional `quantity` or
      `grams`; store the dict's per-unit portions/nutrients and set `quantity`
      from the explicit quantity or `grams ÷ baseGrams` via `gramsToQuantity`;
      copy `baseGrams`; source `dict`) or manual (per-unit portions → derived
      per-unit nutrients + classified, or per-unit nutrients → `unclassified` +
      zero portions; `quantity` 1). → verify: unit tests for create,
      append-to-existing-meal, dict + manual items, grams↔quantity mutual
      exclusion, and that stored columns equal per-unit (not per-unit × quantity).
- [ ] 3.2 `getDayMeals` use case: return the day's meals ordered by `time`, each
      with its items (exposing both per-unit + quantity and the derived consumed
      amount), plus per-day nutrient totals and per-day portion totals summed as
      the **consumed amount (per-unit × quantity)** across **all** items via
      `scaleByQuantity`. Replaces `getDayDietLog`. → verify: ordering by time;
      totals sum consumed across meals; unclassified items add nutrients but zero
      portions.
- [ ] 3.3 `updateMealItem` use case: reject an empty patch; otherwise apply the
      Model Y patch (quantity → set `quantity` only; grams → `quantity =
      grams ÷ baseGrams`; per-unit portions → set per-unit columns + recompute
      per-unit nutrients + mark classified) and pass through; null → not found.
      → verify: each path leaves the per-unit values untouched on a quantity/gram
      edit (no double-scale), portions edit recomputes per-unit nutrients,
      empty-patch rejection, owner scoping.
- [ ] 3.4 `deleteMealItem`, `updateMealTime`, `deleteMeal` use cases (owner-scoped
      pass-throughs; delete meal cascades items). → verify: unit tests incl.
      foreign-user not-found.
- [ ] 3.5 `getLoggedDays` re-pointed at `MealRepository.listLoggedDays`.
- [ ] 3.6 Re-point `getDailyTargetWithRemaining` to sum logged portions as the
      **consumed amount (per-unit × quantity)** across the day's meal items (via
      `MealRepository.listMealsByDay`), dropping the `DietLogRepository`
      dependency. → verify: existing remaining/carry-forward tests pass against
      meal items.
- [ ] 3.7 Remove `get-day-diet-log.ts`, `log-food-entry-from-dictionary.ts`,
      `log-manual-food-entry.ts`, `update-food-entry.ts`, `delete-food-entry.ts`.

## 4. Adapters (Drizzle + Hono + DI)

- [ ] 4.1 `DrizzleMealRepository` implementing `MealRepository`: upsert meal on
      `(user_id, day, meal)`; batch-insert items storing per-unit columns +
      `quantity`; day query joins meal + items and returns per-unit + quantity
      (consumed is derived in the application layer, not in SQL);
      `updateItem` writes only `quantity` on a quantity/gram edit and only the
      per-unit columns (+ recomputed per-unit nutrients) on a portions edit —
      never both; `updateItem`/`deleteItem` scoped via the parent meal's
      `user_id`; `deleteMeal` relies on the FK cascade; numeric string↔number
      parsing as in the other repos.
- [ ] 4.2 New Hono routes (behind auth, owner-scoped): `POST /api/meals`,
      `GET /api/meals?day=`, `GET /api/meals/logged-days?month=`,
      `PATCH /api/meals/:id`, `DELETE /api/meals/:id`,
      `PATCH /api/meal-items/:id`, `DELETE /api/meal-items/:id`. Validate with the
      existing helpers (`requireDay`, `requireMonth`, `requireString`, numeric ≥ 0,
      timestamp for `time`); not-found → 404, empty item patch → 400, both
      grams+quantity → 400.
- [ ] 4.3 Wire the new use cases + routes from `src/index.ts`; construct
      `DrizzleMealRepository` and inject it into the meal routes and
      `getDailyTargetWithRemaining`.
- [ ] 4.4 Remove `drizzle-diet-log-repository.ts`, the `diet-entries` routes/handlers,
      and the old `dietLogRepository` wiring.

## 5. Remove / rewrite orphaned `food_entry` tests

These test files import now-removed `food_entry` symbols
(`FoodEntry`/`DietLogRepository`/`logManualFoodEntry`/…) and would break the
typecheck/test gate; each must be deleted or rewritten to the meal/item model:

- [ ] 5.1 Delete `test/adapters/http/diet.test.ts` and
      `test/contexts/health/application/diet-log.test.ts` (old diet-entries route
      + diet-log use-case tests); replace with the new meal/meal-item tests
      (tasks 3.x, 6.1).
- [ ] 5.2 Rewrite `test/contexts/health/application/daily-target.test.ts` — its
      `InMemoryDietLogRepository` + `logManualFoodEntry` usage becomes an in-memory
      `MealRepository` seeded with meal items (consumed = per-unit × quantity), so
      the carry-forward/remaining assertions run against the new sum.
- [ ] 5.3 Update `test/adapters/http/app.test.ts` — its `stubDietLogRepository` /
      `dietLogRepository` wiring becomes a stub `MealRepository` matching the new
      composition root.

## 6. Verify

- [ ] 6.1 Workers-pool HTTP tests (inject fakes) for all seven routes incl. auth
      (401), owner-scoping (404), validation (400), and the day/totals response
      (consumed = per-unit × quantity).
- [ ] 6.2 `npm test` and `npm run typecheck` both green (no dangling
      `food_entry` imports).
- [ ] 6.3 `openspec validate --strict add-meal-entry-model` passes.
