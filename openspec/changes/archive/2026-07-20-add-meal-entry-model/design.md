## Context

The original diet model (change `add-diet-tracking`) made each eaten food an
independent `food_entry` with its own `eaten_at`. The frontend redesign reframes
the unit of logging as a **meal** eaten at one time that contains several food
items. Two client flows drive this change and are the acceptance basis:

- **PR② — full-screen search / build a meal**: the user picks a meal slot for a
  day, searches the dictionary, adds several items (and manual/AI items), and
  saves them together. The backend must accept a whole meal (day + meal + time +
  many items) in one call and reuse an existing meal for that slot.
- **Today view**: the day shows each meal with its time, its items, and per-day
  totals for the target view.
- **PR③ — per-item / per-meal-time edit**: the user changes one item's amount
  (by quantity, by portions, or by a gram amount that recomputes portions and
  nutrients), removes an item, edits a meal's single time, or deletes a whole
  meal.

Backend constraints are unchanged (repo `CLAUDE.md`): Cloudflare Workers + Hono,
Drizzle → Neon, Firebase auth, Clean Architecture / DDD, context-first layout in
`contexts/health`.

## Goals / Non-Goals

**Goals:**
- Make the meal a first-class entity (one time, many items) and the item the
  store of record, replacing `food_entry`.
- Support the three client flows above with the smallest, most atomic set of
  endpoints.
- Preserve the two-axis store (D1) and reuse the existing pure conversion /
  quantity domain modules unchanged.

**Non-Goals:**
- Migrating existing `food_entry` data — there is none, so the migration drops
  the table.
- Any change to the food dictionary, favorites, or daily-target write path.
- AI-photo estimation, exercise-earned target bonus, or auto-computed targets —
  still deferred, the `source` / `bonus` seams are unchanged.

## Decisions

### D1 (retained) — Two orthogonal axes; store of record moves to `meal_item`

The two-axis decision from `add-diet-tracking` is unchanged: each logged food
stores **both** atomic nutrients `{ carb_g, protein_g, fat_g, sugar_g, fiber_g,
kcal }` (authority for calorie/nutrient totals) **and** food-group portions
`{ staple, meat, fruit, veg }` (authority for the portion/target view). Portions
are stored, not derived from grams; calories are always derived from nutrients
and never from portion counts. The store of record for a logged food moves from
`food_entry` to `meal_item`.

**One refinement vs the old `food_entry` (per-unit, not final).** The old
`food_entry` stored the *final consumed* portions/nutrients and had no quantity
column. `meal_item` instead stores the **per-unit** portions/nutrients (the
amount for `quantity = 1`) alongside a stored `quantity` multiplier (see D3). The
**consumed amount = per-unit × quantity**, computed on read, never stored. This
keeps the two axes intact (per-unit portions are stored, not inferred from grams;
per-unit calories come from nutrients) while making re-amounting exact and
divergence-free — changing `quantity` never re-scales the stored per-unit values,
so there is no double-scaling and no stale third representation.

### D2 — Meal entity: one meal per (user, day, meal), single time

`meal_entry` holds `user_id`, `day` (date), `meal` (text), and one `time`
(timestamptz) with `unique(user_id, day, meal)`. The single `time` replaces the
old per-item `eaten_at`; the day view orders meals by `time`. `meal` is a
standard meal or a snack label (free text), matching the old meal model. `day` is
the authoritative calendar bucket set at creation; editing a meal's `time`
adjusts only the clock and does **not** move the meal to another `day` — this
avoids a `unique(user, day, meal)` collision on the target day and matches the
client, which always creates a meal against an explicit day. (This is a
deliberate departure from the old `food_entry` rule that editing `eaten_at`
across midnight moved the entry's day.)

### D3 — `meal_item` stores per-unit values + `quantity` + `base_grams`; consumed = per-unit × quantity

`meal_item` columns: per-unit `{ staple, meat, fruit, veg }` + per-unit
`{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }`, plus `quantity` (numeric
multiplier, default 1), `base_grams` (numeric, nullable), `unclassified`,
`source`, `name`, `photo_ref`, and `food_item_id`. **The consumed amount is
`per-unit × quantity`, derived on read — never stored** — so there is exactly one
place the multiplier lives (the `quantity` column) and no possibility of the
stored values and `quantity` disagreeing.

Editing (PR③), all on `PATCH /api/meal-items/:id`:
- **by quantity** → set `quantity` directly; per-unit columns are untouched.
- **by grams** → `quantity = grams ÷ base_grams` (requires `base_grams`); per-unit
  untouched. (`base_grams` is copied from the dictionary item at add time so no
  dictionary lookup is needed later.)
- **by portions** (re-categorization) → set the **per-unit** portion columns
  directly, recompute the **per-unit** nutrients from them via the existing
  conversion rules (the same portions→nutrients derivation manual creation
  uses), and mark the item classified. `quantity` is untouched. (This does not
  violate D1: calories/nutrient totals are still read from the stored nutrient
  columns, never counted from portions — the conversion only sets those nutrient
  columns at input/edit time, as it always has.)

So a quantity/gram edit only writes `quantity`; a portions edit only writes
per-unit columns. Neither multiplies stored values, so `scaleByQuantity` is used
**only** to derive the consumed amount for reads/totals (per-unit → consumed),
never to rewrite stored columns. This removes the double-scale / stale-quantity
divergence entirely. `food_item_id` (nullable) records the source dictionary item
(null for manual/AI items); it has **`ON DELETE SET NULL`** so deleting a
dictionary item never cascades away a logged meal item (the item keeps its stored
per-unit values, which are the store of record).

### D4 — Endpoint shape: atomic, meal- and item-scoped

Chosen routes (thin Hono driving adapter, injected from `src/index.ts`), all
behind auth and owner-scoped:

```
POST   /api/meals              create-or-append: body { day, meal, time, items[] }
GET    /api/meals?day=         day view: meals (with items, ordered by time) + totals
GET    /api/meals/logged-days?month=   distinct days with ≥1 meal, ascending
PATCH  /api/meals/:id          update a meal's time
DELETE /api/meals/:id          delete a meal (cascades its items)
PATCH  /api/meal-items/:id     update an item (quantity | portions | grams → recompute)
DELETE /api/meal-items/:id     delete a single item
```

- **POST /api/meals** matches PR②'s "done" button: it upserts the `meal_entry`
  for `(user, day, meal)` (creating it with `time` when absent, reusing it when
  present) and inserts every item in `items[]` in one call. Each item is either a
  dictionary item (`food_item_id` + optional `quantity`/`grams`), a manual item
  (portions or nutrients), giving one entry point for all item sources.
- The daily-target endpoints (`GET`/`PUT /api/daily-target`) are unchanged; only
  the internal "logged portions" sum is re-pointed at meal items.

Alternatives considered: a separate `POST /api/meals` (create meal) + `POST
/api/meals/:id/items` (add items) pair. Rejected — the client always saves a meal
and its items together, so the single upsert POST is fewer round-trips and the
natural atomic unit. Adding items to an existing meal is the same POST with the
same `(day, meal)`.

### D5 — Totals computed in the read use cases, summed across all items

Per-day nutrient totals (`carb_g … kcal`) and per-day portion totals
(`staple/meat/fruit/veg`) are computed in the application layer by summing the
**consumed amount (per-unit × quantity, per D3) of all `meal_item` rows of all
the day's meals** — nothing is stored. Likewise each item in the day view is
returned with its consumed portions/nutrients (per-unit × quantity) for display
plus its per-unit values + quantity for editing. The day-view use case returns
nutrient + portion totals; the daily-target use case
(`getDailyTargetWithRemaining`) reuses the same portion sum for `remaining =
effective_target − sum(logged portions)`. Unclassified items carry zero portions
(D1), so they contribute to nutrient/calorie totals but never reduce remaining
portions — unchanged from before. The `MealRepository` exposes a day query that
returns meals-with-items so both use cases sum from the same source.

### D6 — Removal list

Everything bound to `food_entry` is removed, since the meal/item model replaces
it:

- Domain: `food-entry.ts` (`FoodEntry`, `FoodEntrySource` — the enum type moves
  onto `meal_item`), `diet-log-repository.ts` (`DietLogRepository`,
  `CreateFoodEntryInput`, `UpdateFoodEntryPatch`).
- Application: `get-day-diet-log.ts`, `get-logged-days.ts` (rebound to the meal
  repo), `log-food-entry-from-dictionary.ts`, `log-manual-food-entry.ts`,
  `update-food-entry.ts`, `delete-food-entry.ts`.
- Adapters: `drizzle-diet-log-repository.ts`; the `diet-entries` HTTP routes and
  their handlers; the `dietLogRepository` wiring is replaced with `mealRepository`.
- Schema: the `food_entry` table (and its Drizzle export).

Kept unchanged: `conversion.ts`, `quantity.ts`, `food_item` / `food_favorite` /
`daily_target` / `users` tables, the food-dictionary and daily-target use cases,
adapters, and routes (only `getDailyTargetWithRemaining`'s repo dependency
changes from `DietLogRepository` to `MealRepository`).

### D7 — Migration

One Drizzle migration:
1. `CREATE TABLE meal_entry` with `unique(user_id, day, meal)` and FK
   `user_id → users(id)`.
2. `CREATE TABLE meal_item` with FK `meal_entry_id → meal_entry(id) ON DELETE
   CASCADE` and nullable FK `food_item_id → food_item(id) ON DELETE SET NULL`
   (deleting a dictionary item never removes a logged meal item — it keeps its
   stored per-unit values, which are the store of record).
3. `DROP TABLE food_entry`.

`meal` is free text so a snack can be named anything ("點心", "點心2", "下午茶").
The `unique(user_id, day, meal)` key means a user could in principle name a snack
"breakfast" and collide with the standard breakfast meal; this is a client-owned
naming concern (the client picks standard-meal codes vs snack labels), matching
the old free-text `food_entry.meal`, and is out of scope to enforce server-side.

Numeric portion/nutrient/quantity/base_grams columns are `numeric` (decimals like
0.5 portions, 0.66 quantity). The shared enum `food_entry_source`
(`manual`/`ai_photo`/`dict`) is reused for `meal_item.source` (renamed
conceptually to a meal-item source; the pg enum values are unchanged).

## Acceptance basis — the three client flows

The API is accepted when it supports the three flows end-to-end:

1. **Build a meal (PR②)**: `POST /api/meals { day, meal, time, items:[dict + manual] }`
   creates the meal and all items in one call; a second POST with the same
   `(day, meal)` appends more items to that meal (no duplicate meal).
2. **Today view**: `GET /api/meals?day=` returns each meal (ordered by time) with
   its items and per-day nutrient + portion totals; `GET /api/daily-target?day=`
   returns remaining portions computed from the same item sum.
3. **Edit (PR③)**: `PATCH /api/meal-items/:id` re-amounts an item (quantity /
   portions / grams recompute); `DELETE /api/meal-items/:id` removes an item;
   `PATCH /api/meals/:id` changes a meal's time; `DELETE /api/meals/:id` removes a
   meal and (cascade) its items. All owner-scoped — another user's meal/item is
   not found.

## Testing strategy

- **Domain / application** (plain Vitest, `unit` project, in-memory
  `MealRepository`): meal upsert reuses the `(user, day, meal)` meal and appends
  items; day view groups items under meals ordered by time and totals nutrients +
  portions across all items; item patch recomputes portions/nutrients from
  quantity / portions / grams (and clears/keeps `unclassified` per D1); owner
  scoping (foreign user → not found); daily-target remaining sums across items;
  empty item-patch rejected. Reuse the existing `conversion` / `quantity` tests
  unchanged.
- **HTTP adapters** (`@cloudflare/vitest-pool-workers`, `workers` project,
  injected fake repo): the seven routes incl. auth (401), owner-scoping (404 on
  another user's meal/item), validation errors (400).
- **Date-boundary care**: reuse `requireDay` (component comparison, not
  `Date.parse`, so `2026-02-30` is rejected rather than rolled over) and
  `requireMonth`; logged-days must not raise a date-range error on February
  (`2026-02`), matching the existing month range query. Meal `time` uses
  `optionalTimestamp` / a required-timestamp variant.
