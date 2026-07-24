# Tasks

## 1. Vitals repository: batch upsert (TDD)
- [ ] **Reuse the existing `VitalsRepository.listRange(userId, from, to)`** for the
      range read (already declared in `domain/vitals-repository.ts` and implemented
      as a single ordered SELECT) — do NOT add a duplicate `listInRange`.
- [ ] Domain port `VitalsRepository`: add ONLY `setMany(rows: VitalsSetInput[]):
      Promise<void>` (VitalsSetInput = the existing `set` input shape).
- [ ] `DrizzleVitalsRepository.setMany`: one `db.batch([...])` of per-row upserts
      (on-conflict (user_id, day) do update — mirror the existing `set` upsert).
      Empty input → no-op (no batch call).
- [ ] In-memory `VitalsRepository` fake (test support) implements `setMany` (and
      already/also `listRange`).

## 2. Meal repository: batched createMeals (TDD)
- [ ] Domain port `MealRepository`: add `createMeals(entries: MealEntryInsert[],
      items: MealItemInsert[]): Promise<void>` where entry ids are caller-supplied.
- [ ] `DrizzleMealRepository.createMeals`: one `db.batch([...])` = multi-row insert
      into `meal_entry` + multi-row insert into `meal_item` (no select-back). Empty
      entries → no-op.
- [ ] In-memory `MealRepository` fake implements it (and keeps `listMealsInRange`).

## 3. Rewrite `importChaodaysDiet` to batch (TDD — behavior preserved)
- [ ] Replace per-day `listMealsByDay` with one `listMealsInRange`; replace per-day
      `vitals.get` with one `vitals.listRange`; build a `Map<day, Vitals>`.
- [ ] Compute in memory: per (day, meal) skip-if-preexisting; generate a client-side
      `crypto.randomUUID()` per new meal_entry; build meal_entry rows + meal_item
      rows (items reference their entry id); accumulate per-day merged+deduped
      glucose (same dedup key) and the full vitals row (preserving other fields).
- [ ] Persist via `createMeals(entries, items)` then `setMany(vitalsRows)`.
- [ ] Tests (in-memory repos) all still pass and now assert batched calls:
      idempotency (pre-existing (day,meal) skipped), same-type merge, glucose dedup +
      other-vitals preserved, malformed timestamp fallback, empty range → zero writes
      and no batch calls.

## 4. Wire + cleanup
- [ ] `src/index.ts`: no new deps expected (same repos) — verify DI still compiles.
- [ ] Remove the temporary diet-500 diagnostic in
      `adapters/http/routes/import-chaodays.ts` (the try/catch + `diet_import_failed_DIAG`
      + the extra `Chaodays*Error` value import) so the diet handler matches the
      other handlers again.

## 5. Gate
- [ ] `npm test` + `npm run typecheck` green.
