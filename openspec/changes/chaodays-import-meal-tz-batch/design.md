# Design — chaodays import: correct diet meal codes + record timezone, and batch weight/water/bowel

Three cohesive chaodays-import fixes, surfaced now that diet actually imports.

## A. Diet meal type must be a lifeos meal CODE, not the localized name

lifeos stores `meal_entry.meal` as a **standard-meal code** — `breakfast`/`lunch`/
`dinner` — and treats any other value as a snack shown verbatim (frontend
`meal_label.dart`: `standardMeals = ['breakfast','lunch','dinner']`,
`isStandardMeal`, `mealDisplayLabel` localizes only those three). The import writes
the Chinese display string (`"早餐"`), so lifeos sees a *snack literally named 早餐*
("自訂的早餐") instead of the real breakfast.

**Fix:** map chaodays record types to lifeos codes:
`breakfast→"breakfast"`, `lunch→"lunch"`, `dinner→"dinner"`, `extra→"點心"`
(extra is already correct — a snack whose value is its own name). Change is the
`MEAL_NAME_BY_RECORD_TYPE` constant in `import-chaodays-diet.ts` + its tests.

## B. Diet meal time is off by the timezone (~8h)

chaodays `recorded_at` is `"YYYY-MM-DD HH:mm"` **wall-clock in Taiwan**, but the
import does `new Date("...T08:30")`, which the Workers (UTC) runtime reads as UTC →
the stored instant is 8h off (user confirmed). The client currently drops chaodays's
timezone field entirely.

**Fix:** interpret `recorded_at` as **+08:00** (Asia/Taipei — chaodays is a Taiwan
app; confirmed offset). Build the meal time as
`new Date(\`${recorded_at.replace(" ", "T")}:00+08:00\`)` via a named
`CHAODAYS_TZ_OFFSET = "+08:00"` constant; keep the existing malformed-timestamp
fallback to the day's start. Only diet is affected (weight/water/bowel key off
`record.date`, not a time-of-day). Honoring a per-record timezone field is a
possible future enhancement; a fixed +08:00 is correct for the user today.

## C. Batch weight / water / bowel imports (subrequest cap)

Same root cause the diet batching (#43) fixed: these importers loop per day issuing
~2 statements/day (get + set), so large ranges exceed the Workers subrequest cap.
Apply the same pattern — bounded, range-independent round-trips, with batching in
repository adapters (use cases stay port consumers):

- **weight** (writes vitals): reuse the existing `vitalsRepository.listRange`
  (range read) + `vitalsRepository.setMany` (batched upsert) — **no new methods**.
  Read the range once, compute ONE merged row PER DAY (preserve existing
  glucose/bp/spo2), write via one `setMany`. **Intra-day carry-forward:** today's
  per-record get()+set() loop means a later same-day record reads the earlier
  record's just-written row, so a record lacking body fat inherits the earlier
  record's body fat. The batched version reads a single pre-import snapshot, so it
  MUST fold a day's records in order: skip records without a weight; final
  `weight` = the last weighted record's; `bodyFat` = the last non-null body fat among
  the day's records in order, else the pre-import value. `imported` still counts
  records-with-weight (not days).
- **bowel** (writes bowel_log): add `BowelRepository.listRange(userId, from, to)`
  and `BowelRepository.setMany(rows)` (adapter: one `db.batch`). Read range once,
  skip days that already have a log (same idempotency), batch-write the rest.
- **water** (writes intake): add `WaterRepository.listIntakeRange(userId, from, to)`
  and a batched write `addIntakeMany(rows: {userId,day,addMl}[])` (adapter: one
  `db.batch`). Read range once, skip days that already have intake (same
  idempotency), batch-add the rest. (Keep `addIntake` semantics: a new day's intake
  is the summed total; days summing to 0 are not written.)

In-memory repo fakes mirror the new methods for the use-case tests.

## Behavior preserved
All existing import behavior/idempotency/summaries unchanged — weight (skip records
without weight; don't erase existing body fat), water (sum per day; skip existing;
zero not written; empty range → zero/zero), bowel (aggregate per day; invert
abnormality→normality; join notes; skip existing). Diet behavior unchanged except
the two corrections above.

## Scope
weight/water/bowel batching + the two diet corrections. Not touching diet's batching
(already done in #43) beyond the meal-code/time constants. Gate = `npm test` +
`npm run typecheck`.

## Testing
- Diet: tests assert `breakfast`/`lunch`/`dinner` codes (not Chinese) and that a
  `recorded_at` produces the correct UTC instant (+08:00 applied); snack (extra) and
  malformed-timestamp fallback unchanged.
- weight/water/bowel: existing behavior tests pass under batching + new assertions
  that persistence goes through the batch methods (bounded calls, not per-day) and
  empty range → zero write calls.
- True end-to-end (large-range import succeeds; meal shows real breakfast at the
  right time) verified by the user after deploy.
