## Why

Diet logging currently models every eaten food as its own `food_entry` row, each
carrying its own `eaten_at` timestamp. The frontend redesign treats a **meal** as
the thing the user eats at one time, containing several food items: PR② is a
full-screen search that builds a meal out of many items and saves them together,
and PR③ edits an item's amount or a meal's single time after the fact.
Representing that on the current per-food-entry model forces the client to
synthesize "meals" from loose entries and to repeat one shared time on every
item. The user chose to redesign the backend so the meal is a first-class entity
rather than papering over it in the client.

This is a breaking API change: new endpoints and payloads, and the old
`food_entry` table is dropped. That is acceptable now — no production data exists
to migrate, and the only client (PR②③) ships against the new shape.

## What Changes

- **New `meal_entry` table**: a meal is an owner-scoped entity keyed by
  `(user, day, meal)` (unique) with a single `time` timestamp, replacing the old
  per-item `eaten_at`. `meal` is a standard meal (`breakfast`/`lunch`/`dinner`)
  or a snack label (`點心`/`點心2`/`下午茶`).
- **New `meal_item` table**: each food in a meal, `ON DELETE CASCADE` from its
  meal. It carries the same two-axis store of record as the old `food_entry`
  (atomic nutrients `{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }` +
  food-group portions `{ staple, meat, fruit, veg }`) plus `source`,
  `unclassified`, an optional `food_item_id`, `name`, `photo_ref`, and — new —
  `quantity` and optional `base_grams`, so the client can re-edit an item's
  amount and recompute portions/nutrients.
- **Drop `food_entry`** and every piece bound to it: the
  `logFoodEntryFromDictionary`, `logManualFoodEntry`, `updateFoodEntry`,
  `deleteFoodEntry` use cases, the old `getDayDietLog` / `getLoggedDays`, the
  `FoodEntry` type, and the `DietLogRepository` port.
- **New use cases / endpoints** (all owner-scoped): create-or-append a meal with
  many items in one POST; read a day (meals with their items, ordered by meal
  time, plus per-day nutrient and portion totals); patch an item
  (quantity / portions / gram amount → recompute); delete an item; patch a
  meal's time; delete a meal (cascading its items); logged days derived from meal
  entries.
- **Unchanged**: `food_item` (the 271-row seeded dictionary), `food_favorite`,
  `daily_target`, and `users` tables, and all food-dictionary and daily-target
  endpoints. The two-axis decision (D1 in the diet-tracking design) is unchanged;
  only the store of record moves from `food_entry` to `meal_item`. The
  daily-target remaining view now sums logged portions across a day's meal items.

## Impact

- **Affected specs**: `diet-tracking` — rewritten to meal/item semantics (ADDED
  meal-entity and meal/item-CRUD requirements; MODIFIED every requirement that
  named `food_entry`). `food-dictionary` is untouched.
- **Affected code**:
  - `shared/db/schema.ts` + a Drizzle migration (create `meal_entry` +
    `meal_item`, drop `food_entry`).
  - `contexts/health/domain`: new `MealEntry` / `MealItem` entities and a
    `MealRepository` port; remove `FoodEntry` and `DietLogRepository`. The pure
    `conversion.ts` / `quantity.ts` modules are reused unchanged.
  - `contexts/health/application`: new meal/item use cases; remove the five
    `food_entry` use cases; re-point `getDailyTargetWithRemaining` at meal items.
  - `contexts/health/adapters`: new `DrizzleMealRepository`; remove
    `DrizzleDietLogRepository`.
  - `adapters/http`: new meal/meal-item routes; remove the `diet-entries`
    routes; update the composition root wiring in `src/index.ts`.
  - Tests: remove `food_entry` tests; add meal/item unit + Workers HTTP tests.
