## 1. Context scaffold & schema

- [x] 1.1 Create `src/contexts/health/` with `domain/`, `application/`, `adapters/` folders, mirroring `contexts/user/`
- [x] 1.2 Add Drizzle tables `food_item`, `food_favorite`, `food_entry`, `daily_target` to `src/shared/db/schema.ts` per design D5 (grams & portions as `numeric`, `source` enum, uniqueness on `(user_id, day)` for target and `(user_id, food_item_id)` for favorite)
- [x] 1.3 Generate the Drizzle migration and verify it applies against a local/Neon dev database

## 2. Conversion domain logic (TDD)

- [x] 2.1 Write unit tests for nutrient↔portion↔calorie conversion using the spreadsheet calibration points (生米20g→1 staple, 蛋1個→1 meat, 香蕉1根→2 fruit, kcal fallback carb×4+protein×4+fat×9, kcal passthrough when provided)
- [x] 2.2 Implement the pure conversion module in `health/domain` (divisors: staple/fruit=carb÷15, meat=protein÷7, veg=carb÷5) and make 2.1 pass

## 3. Food dictionary

- [x] 3.1 Define `FoodItem` entity + `FoodDictionaryRepository` port (search shared∪own by name substring, create custom, favorite/unfavorite, list favorites) in `health/domain`
- [x] 3.2 Write use-case unit tests with an in-memory repository (custom item private to owner; search excludes non-matches; favorite add/remove) then implement the use cases in `health/application`
- [x] 3.3 Implement `DrizzleFoodDictionaryRepository` in `health/adapters`
- [x] 3.4 Write the seed script that loads the 271-row table, converts each row's portions → nutrients via the module from §2, and inserts shared `food_item` rows; add a test asserting a known row (e.g. 主食1份 ≈ 15 g carb)

## 4. Diet logging

- [x] 4.1 Define `FoodEntry` entity + `DietLogRepository` port (create entry, list a day grouped by meal, delete own entry) in `health/domain`, storing both nutrient and portion axes
- [x] 4.2 Write use-case unit tests (manual entry from portions derives nutrients; log-from-dictionary copies both axes & sets source=dict; nutrient-only entry is marked unclassified and does not reduce remaining; day view grouped by meal; day nutrient/calorie totals computed from atomic fields only; delete removes an entry from day totals) then implement the use cases in `health/application`
- [x] 4.3 Implement `DrizzleDietLogRepository` in `health/adapters`

## 5. Daily target

- [x] 5.1 Define `DailyTarget` entity + `DailyTargetRepository` port (get/set per day, effective = base + bonus) in `health/domain`
- [x] 5.2 Write use-case unit tests (set base goals; effective target = base + bonus; remaining = effective − sum(logged portions) per category) then implement the use cases in `health/application`
- [x] 5.3 Implement `DrizzleDailyTargetRepository` in `health/adapters`

## 6. HTTP adapter & wiring

- [x] 6.1 Add thin Hono routes under `src/adapters/http/routes/` for dictionary search/favorite, diet entry create + day view + delete, daily-target get/set-with-remaining (all behind auth middleware)
- [x] 6.2 Wire the new use cases and repositories from the composition root `src/index.ts`
- [x] 6.3 Write Workers-pool HTTP tests (auth required → 401; create entry from dictionary → persisted with source=dict; day view grouped by meal; target remaining reflects logged entries) injecting fake repositories
- [x] 6.4 Run `npm test` and `npm run typecheck`; confirm both Vitest projects pass
