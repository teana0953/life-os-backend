# Design — batch the chaodays diet import to stay under the Workers subrequest limit

## Context

The real chaodays diet import fails in production with **"Too many subrequests by
single Worker invocation"** (surfaced via a temporary diagnostic added in PR
#40/#41). Cloudflare Workers cap subrequests per invocation (50 on the current
plan); the Neon HTTP driver (`drizzle-orm/neon-http`) issues **one subrequest per
SQL statement**.

`importChaodaysDiet` currently issues O(days × meals × items) statements:
per day `listMealsByDay` (1) + `vitalsRepository.get` (1) + `vitalsRepository.set`
(1) + per new meal `upsertMealWithItems` (SELECT existing + INSERT entry + INSERT
items + SELECT items back = up to 4). A handful of days blows past 50.

Weight import works because it is ≈2 statements/day (vitals get+set), so a modest
range stays under the cap.

## Decision

Restructure `importChaodaysDiet` to make a **bounded, small number of DB
round-trips** regardless of range, by pushing batch DB access into repository
methods (batching is an infrastructure concern — the use case stays a port
consumer, per the repo's hexagonal rule).

Target shape — a **small, range-independent (O(1))** number of subrequests, not a
per-day count. (Concretely ~6–7: signIn + fetchDietRecords + listMealsInRange —
which is itself 2 statements, meal_entry then meal_item — + vitals.listRange +
createMeals batch + setMany batch. The exact count doesn't matter; what matters is
that NO statement is issued per day/meal/item.):
1. `mealRepository.listMealsInRange(userId, from, to)` (already exists), replaces
   the per-day `listMealsByDay`.
2. `vitalsRepository.listRange(userId, from, to)` — **reuse the existing method**
   (do not add a new one), replaces the per-day `get`.
3. Compute everything in memory: which (day, meal) to create (skip pre-existing —
   idempotency unchanged), the per-item rows, and the per-day merged+deduped
   glucose readings. Generate `meal_entry` UUIDs client-side (`crypto.randomUUID`)
   so `meal_item` rows can reference their entry without a round-trip.
4. `mealRepository.createMeals(entries, items)` — NEW; inserts all meal_entries and
   all meal_items in **one `db.batch([...])`** (1 subrequest). No SELECT-back.
5. `vitalsRepository.setMany(rows)` — NEW; upserts all affected days' vitals in one
   `db.batch([...])` (1 subrequest), each row carrying the full merged glucose plus
   the day's preserved other fields (read in step 2).

## Behavior preserved (must not regress)

- **Idempotency**: a (day, meal) that already existed before the import is skipped
  once; multiple same-type chaodays records on a day still merge into one meal.
- **Glucose dedup**: readings already present (same time+value+mealContext+label)
  are not re-appended; a day's other vitals fields (weight/bodyFat/bp/spo2) are
  preserved.
- **Malformed timestamp** fallback to day start is kept.
- Return summary shape (`mealsImported/mealsSkipped/glucoseImported/from/to`)
  unchanged.

## Repository additions (adapters encapsulate `db.batch`)

- `VitalsRepository.listRange` — **already exists; reuse it** for the range read
  (no new method).
- `VitalsRepository.setMany(rows: VitalsSetInput[]): Promise<void>` — NEW; one
  `db.batch` of upserts (on-conflict (user_id, day)).
- `MealRepository.createMeals(entries: MealEntryInsert[], items: MealItemInsert[]):
  Promise<void>` — NEW; one `db.batch` of the two multi-row inserts; entry ids are
  caller-supplied UUIDs.

In-memory (Node) repository fakes implement the same ports for the use-case unit
tests.

## Scope / out of scope

- **In scope:** diet import only (the proven failure) + removing the temporary
  diet-500 diagnostic added in PR #40/#41.
- **Out of scope (follow-up):** weight/water/bowel importers share the per-day
  pattern and could hit the same cap for *large* ranges; not changed here (they
  work for the user's current ranges). Flagged for a later change.

## Testing

- Use-case unit tests (in-memory repos): idempotency, glucose dedup, merge of
  same-type records, malformed timestamp — all still pass, now asserting the batch
  methods are called (few calls, not per-day).
- New repository-method behavior covered where the existing repo tests live.
- Gate: `npm test` + `npm run typecheck`.
- True end-to-end (subrequest count under the cap) is verified by the user
  re-running the real import after deploy.
