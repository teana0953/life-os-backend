# Tasks

## 1. Diet meal codes + timezone (TDD — small, targeted)
- [ ] `import-chaodays-diet.ts`: change `MEAL_NAME_BY_RECORD_TYPE` to
      `{ breakfast: "breakfast", lunch: "lunch", dinner: "dinner", extra: "點心" }`.
- [ ] `import-chaodays-diet.ts`: add `const CHAODAYS_TZ_OFFSET = "+08:00";` and build
      the meal time as `new Date(\`${recordedAt.replace(" ", "T")}:00${CHAODAYS_TZ_OFFSET}\`)`
      (append seconds + offset); keep the `Number.isNaN` fallback to `${day}T00:00:00`.
      (Glucose reading `time` stays the `HH:mm` slice — display only, no tz needed.)
- [ ] Update diet tests: assert meal codes are `breakfast`/`lunch`/`dinner` (not
      Chinese) and `extra`→snack; assert a record with `recorded_at "YYYY-MM-DD 08:30"`
      yields a meal time whose UTC instant is `00:30Z` (08:30 +08:00). Existing
      idempotency/merge/glucose/portion tests still pass.

## 2. Bowel repo: range read + batch upsert (TDD)
- [ ] `BowelRepository` port: add `listRange(userId, from, to): Promise<BowelLog[]>`
      and `setMany(rows: SetBowelLogInput[]): Promise<void>`.
- [ ] `DrizzleBowelRepository`: `listRange` = one SELECT (day BETWEEN); `setMany` =
      one `db.batch([...])` of per-row upserts mirroring `set`; empty → no-op.
- [ ] In-memory bowel fake implements both.

## 3. Water repo: range read + batch add (TDD)
- [ ] `WaterRepository` port: add `listIntakeRange(userId, from, to): Promise<WaterIntake[]>`
      and `addIntakeMany(rows: { userId: string; day: string; addMl: number }[]): Promise<void>`.
- [ ] `DrizzleWaterRepository`: `listIntakeRange` = one SELECT; `addIntakeMany` = one
      `db.batch([...])` of per-row upserts using the same add-clamped-at-0 semantics as
      `addIntake` (for the import, days are new so it's effectively an insert); empty → no-op.
- [ ] In-memory water fake implements both.

## 4. Rewrite weight/water/bowel imports to batch (TDD — behavior preserved)
- [ ] `import-chaodays-weight.ts`: read `vitalsRepository.listRange` once → Map<day,Vitals>;
      compute ONE merged row PER DAY (not per record) in memory, preserving existing
      glucose/bp/spo2. **Fold a day's records in order** to replicate today's
      per-record read-after-write: skip records without a weight; for each record with
      a weight set `weight = record.weight` and `bodyFat = record.bodyFatPct ?? <carry>`
      where `<carry>` is the running body-fat (previous same-day record's, else the
      pre-import value) — so a later same-day record lacking body fat inherits the
      earlier record's, and a day with no imported body fat keeps its existing one.
      Persist one row per touched day via one `vitalsRepository.setMany`. Keep
      `imported` counting **records with a weight** (not days) so the summary is
      unchanged.
- [ ] `import-chaodays-bowel.ts`: read `bowelRepository.listRange` once; skip days with
      an existing log (same idempotency); aggregate per day; persist via one `setMany`.
- [ ] `import-chaodays-water.ts`: read `waterRepository.listIntakeRange` once; sum per
      day; skip days with existing intake; drop days summing to 0; persist via one
      `addIntakeMany`.
- [ ] Tests: existing behavior all passes; add assertions each importer persists via
      the batch method (bounded calls, not per-day) and empty range → zero write calls.

## 5. Wire + gate
- [ ] `src/index.ts` DI still compiles (same repos, new methods).
- [ ] `npm test` + `npm run typecheck` green.
