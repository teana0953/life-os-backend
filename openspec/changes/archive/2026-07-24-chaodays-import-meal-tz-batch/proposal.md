## Why

Now that the diet import actually runs (after the fetch-bind fix and the diet
batching in #43), two data-correctness bugs are visible, and the remaining
importers hit the same subrequest cap for large ranges:

1. **Diet meal type is wrong.** lifeos stores `meal_entry.meal` as a standard-meal
   *code* (`breakfast`/`lunch`/`dinner`; anything else is a snack shown verbatim —
   frontend `meal_label.dart`). The import writes the localized Chinese name
   (`"早餐"`), so every meal lands as a snack literally named 早餐 ("自訂的早餐")
   instead of the real breakfast/lunch/dinner.
2. **Diet meal time is off ~8h.** chaodays `recorded_at` is Taiwan wall-clock but is
   parsed as UTC in the Workers runtime (confirmed 8h shift); chaodays's timezone is
   dropped by the client.
3. **weight/water/bowel imports can exceed the Workers subrequest cap** for large
   ranges — same per-day-loop cause the diet batching (#43) already fixed.

## What Changes

- **Diet meal codes:** `MEAL_NAME_BY_RECORD_TYPE` maps to lifeos codes —
  `breakfast→"breakfast"`, `lunch→"lunch"`, `dinner→"dinner"`, `extra→"點心"`
  (snack; unchanged).
- **Diet meal time:** interpret `recorded_at` as **+08:00** (Asia/Taipei) via a
  `CHAODAYS_TZ_OFFSET` constant, so the stored instant is correct; malformed-timestamp
  fallback preserved. (Only diet uses a time-of-day; weight/water/bowel key off
  `record.date`.)
- **Batch weight/water/bowel** to a range-independent number of DB round-trips
  (batching hidden in adapters, use cases stay port consumers):
  - weight: reuse existing `vitals.listRange` + `vitals.setMany` (no new methods).
  - bowel: new `BowelRepository.listRange` + `setMany` (adapter = one `db.batch`).
  - water: new `WaterRepository.listIntakeRange` + `addIntakeMany` (one `db.batch`).
  In-memory fakes mirror the new methods.

All existing import behavior/idempotency/summaries are unchanged; diet behavior is
unchanged except the two corrections. Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `chaodays-import`: the diet import SHALL record each meal under its lifeos standard
  meal code (or a snack) rather than a localized name, and SHALL store each meal's
  time at the record's actual (Taiwan) offset; and the weight, water, and bowel
  imports SHALL complete for multi-week ranges without exceeding the platform's
  per-invocation subrequest limit — all with existing import behavior preserved.
