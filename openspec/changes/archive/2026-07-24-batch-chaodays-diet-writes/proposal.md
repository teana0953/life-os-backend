## Why

The real chaodays **diet** import fails in production with
`Too many subrequests by single Worker invocation`. Cloudflare Workers cap
subrequests per invocation (50 on the current plan) and the Neon HTTP driver issues
one subrequest per SQL statement. `importChaodaysDiet` runs O(days × meals × items)
statements (per-day `listMealsByDay`, per-meal select-existing + insert-entry +
insert-items + select-back, per-day vitals get + set), so a handful of days exceeds
the cap. Weight import survives only because it is ~2 statements/day.

(Root cause confirmed by a temporary diagnostic added in PR #40/#41, which this
change removes.)

## What Changes

- **`importChaodaysDiet` is restructured to a bounded number of DB round-trips**,
  independent of the date range — batching is encapsulated in repository adapters
  (the use case stays a port consumer):
  - Read existing meals for the whole range once (`listMealsInRange`, already
    exists) and existing vitals for the whole range once (reuse existing `listRange`) —
    replacing the per-day `listMealsByDay` / `get`.
  - Compute all writes in memory (meals to create — pre-existing skipped, same
    behavior; per-day merged+deduped glucose), generating `meal_entry` UUIDs
    client-side so items reference their entry without a round-trip.
  - Write all meal entries + items in one batched call (`createMeals`, new) and all
    affected days' vitals in one batched upsert (`setMany`, new), each via
    `db.batch([...])` (one subrequest per batch).
- **New repository methods** (adapters use `db.batch`; in-memory fakes mirror them):
  `VitalsRepository.setMany`, `MealRepository.createMeals` (vitals range read reuses the existing `listRange`).
- **Remove the temporary diet-500 diagnostic** from
  `adapters/http/routes/import-chaodays.ts` (added in PR #40/#41).

Diet import behavior is unchanged (idempotency per (day, meal); same-type records
merge; glucose dedup and preservation of other vitals; malformed-timestamp
fallback; same summary shape) — only the number and shape of DB statements change.

**Out of scope:** weight/water/bowel importers share the per-day pattern and could
hit the same cap for very large ranges; they work for current ranges and are left
for a follow-up. Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `chaodays-import`: the diet import SHALL complete for multi-week ranges without
  exceeding the platform's per-invocation subrequest limit, by reading existing
  meals/vitals for the range in a bounded number of queries and writing meals and
  vitals via batched operations — with all existing diet-import behavior preserved.
