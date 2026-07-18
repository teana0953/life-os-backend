## 1. Schema & migration

- [x] 1.1 Add `base_grams` (nullable `numeric`) to `food_item` and `eaten_at` (`timestamptz` NOT NULL DEFAULT now()) to `food_entry` in `src/shared/db/schema.ts`
- [x] 1.2 Generate the Drizzle migration and verify it applies against the Neon dev database

## 2. Quantity & gram conversion (domain, TDD)

- [x] 2.1 Write unit tests for quantity scaling (item × 1.5 → portions and nutrients ×1.5) and gram→quantity conversion (grams ÷ base_grams; error/guard when base_grams is null or ≤ 0)
- [x] 2.2 Implement the pure helpers in `health/domain` (scale-by-quantity, grams→quantity) and make 2.1 pass

## 3. Dictionary logging with quantity & grams

- [x] 3.1 Extend `logFoodEntryFromDictionary` to accept an optional `quantity` (default 1, finite, > 0) and scale nutrients + portions via §2; keep default-1 behavior identical
- [x] 3.2 Support gram-based logging: accept a `grams` amount, convert to quantity via the item's `base_grams`, and reject (typed error) when `base_grams` is null
- [x] 3.3 Write/extend use-case unit tests (default quantity unchanged; quantity 1.5 scales; grams 33 on base_grams 50 → 0.66; grams with null base_grams → error)

## 4. Eaten-at time & ordering

- [x] 4.1 Add `eatenAt` to the `FoodEntry` entity and `CreateFoodEntryInput`; default it to creation time, allow a user-supplied value; keep `loggedAt` system-assigned
- [x] 4.2 Change `getDayDietLog` to order entries by `eatenAt` (not `loggedAt`); update the `DrizzleDietLogRepository` and in-memory test repos
- [x] 4.3 Write use-case unit tests (eaten_at defaults to now; explicit eaten_at stored while logged_at stays system time; a back-dated breakfast sorts before an earlier-logged dinner)

## 5. Seed base_grams backfill

- [x] 5.1 Extend the seed mapping to backfill `base_grams` from a bare gram unit token in the row name (`飯/50g` → 50), leaving household-unit rows null; add unit tests (`飯/50g` → 50, `飯/1碗` → null)
- [x] 5.2 Regenerate `food-dictionary-seed-data.ts` if the seed source shape changed, and confirm `seedRowToFoodItem` carries `base_grams` (no shape change was needed — the seed source `.tsv`/data file is untouched; `seedRowToFoodItem` parses `base_grams` at seed-map time from the existing `name` field)

## 6. HTTP & wiring

- [x] 6.1 Extend `POST /api/diet-entries` to accept optional `quantity`, `grams`, and `eaten_at` (validated: quantity/grams finite > 0, eaten_at a valid timestamp, and `grams`/`quantity` mutually exclusive → 400) for the dict and manual paths as applicable
- [x] 6.2 Write Workers-pool HTTP tests (dict log with quantity 1.5 scales; gram log converts; gram log on null base_grams → 400; both grams and quantity supplied → 400; `base_grams` present in a dictionary item's JSON response; eaten_at ordering reflected in the day view) injecting fake repositories
- [x] 6.3 Run `npm test` and `npm run typecheck`; both green

## 7. Re-seed & verify

- [x] 7.1 Run `npm run db:seed` to re-seed the 271-row dictionary with `base_grams`; verify a gram-unit row (e.g. `飯/50g`) has base_grams set and a household-unit row is null
