# Tasks

TDD throughout. `npm test` + `npm run typecheck` before finishing. Additive, no SQL
migration (JSONB). Snake_case at the API boundary; camelCase in domain/storage.

## 1. Domain
- [x] 1.1 In `src/contexts/health/domain/vitals.ts`, add
      `type GlucoseMealContext = "fasting" | "pre_meal" | "post_meal"` and
      `GlucoseReading.mealContext: GlucoseMealContext | null` (required-nullable, per
      the `pulse: number | null` pattern). Update the existing `{ label, value, time }`
      literals in `src/` to add `mealContext: null`.

## 2. Trend split
- [x] 2.1 Test first in `test/contexts/health/domain/vitals-series.test.ts`: a day's
      glucose readings split into `glucoseFasting` / `glucosePreMeal` /
      `glucosePostMeal` / `glucoseUnspecified` (daily mean per context; unspecified =
      null context), while the existing `glucose` series stays the mean of all.
- [x] 2.2 In `vitals-series.ts`, add the four series to `VitalsSeries` and populate
      them in `buildVitalsSeries` (mean rounded to whole number, one point per day
      with ≥1 reading of that context; empty otherwise). `glucose` unchanged.

## 3. Storage
- [x] 3.1 `src/shared/db/schema.ts`: extend the `glucose_readings` JSONB `$type` with
      `mealContext?: GlucoseMealContext | null`.
- [x] 3.2 `src/contexts/health/adapters/drizzle-vitals-repository.ts`: in the row→domain
      map, normalize `mealContext: r.mealContext ?? null` (legacy rows lack the key).
      Save passes it through. Test in the drizzle repo test.

## 4. API (route)
- [x] 4.1 Test first in `test/adapters/http/vitals.test.ts`: PUT accepts a glucose
      reading with a valid `meal_context`, round-trips it in the response and on
      re-read; an unknown `meal_context` (e.g. `"brunch"`) → 400; absent → null.
- [x] 4.2 In `src/adapters/http/routes/vitals.ts`: parse/validate `meal_context` in the
      `glucose_readings` mapping (one of the three or null, else `BadRequestError`);
      `toJson` maps each glucose reading to snake_case incl. `meal_context`;
      `seriesToJson` adds `glucose_fasting` / `glucose_pre_meal` / `glucose_post_meal`
      / `glucose_unspecified`.

## 5. Gates
- [x] 5.1 `npm test` green, `npm run typecheck` clean. Update any remaining
      `GlucoseReading` literals in tests to include `mealContext`.
