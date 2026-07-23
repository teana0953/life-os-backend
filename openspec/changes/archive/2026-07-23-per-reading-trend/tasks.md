# Tasks

TDD throughout. `npm test` + `npm run typecheck` before finishing.

## 1. Series
- [x] 1.1 Rewrite tests in `test/contexts/health/domain/vitals-series.test.ts` for
      per-reading semantics: one point per reading with its `time`; scalars one per
      day with `time: ""`; pulse one per pulse across bp+spo2; glucose one per
      reading carrying `mealContext`; series ordered by day then time.
- [x] 1.2 In `src/contexts/health/domain/vitals-series.ts`: add `time` to `Point`,
      add `GlucosePoint extends Point { mealContext }`, make `glucose: GlucosePoint[]`,
      remove the four daily-mean context series. `buildVitalsSeries` emits one point
      per reading (scalars one per day, `time ""`) and sorts each series by day/time.

## 2. Route
- [x] 2.1 `src/adapters/http/routes/vitals.ts`: `seriesToJson` maps glucose points to
      snake_case incl. `meal_context`; drop the four `glucose_*` context keys. Points
      already carry `time`. Update the range test's expected series shape.

## 3. Gates
- [x] 3.1 `npm test` green, `npm run typecheck` clean.
