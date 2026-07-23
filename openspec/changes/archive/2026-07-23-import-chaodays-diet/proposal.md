## Why

Second (and heaviest) slice of "import from chaodays": diet records plus the blood
glucose the user typed as free text inside diet item names. Reuses the chaodays
connector from slice 1 (devise_token_auth, error mapping); adds a diet endpoint and
the parsing.

## What Changes

- **`ChaodaysClient`** gains `fetchDietRecords(session, from, to)` (+ `HttpChaodaysClient`
  impl): chaodays `GET /users/diet_records` → per-meal records with items, rotating the
  session; a non-JSON/non-array 200 maps to `ChaodaysUpstreamError` (as in slice 1).
- **Glucose parsing** (pure domain fns): `parseGlucoseReadings(name, time)` extracts
  `前血糖：N` → pre-meal, `後血糖(Nhr)：N` → post-meal (possibly several), `空腹…` →
  fasting, ignoring value-less notes; `stripGlucoseText(name)` returns the food part.
- **`importChaodaysDiet`** use case (MealRepository + VitalsRepository + ChaodaysClient):
  maps `breakfast/lunch/dinner/extra` → `早餐/午餐/晚餐/點心`; for each item, extracts
  glucose and — if it has portions or a non-empty food name after stripping — imports it
  as a meal item (staple/meat/fruit/veg only; **oil/sugar dropped**). Meals are
  **idempotent by (day, meal)**: a day+meal that already exists is skipped, not
  duplicated (lifeos meal items are append-only). Glucose is appended to that day's
  vitals via read-modify-write, **de-duplicated** by (time, value, mealContext).
  Returns `{ mealsImported, mealsSkipped, glucoseImported, from, to }`.
- **`POST /api/import/chaodays/diet`** (authenticated): body `{ chaodays_uid,
  chaodays_password, start_date, end_date }` → summary. Same validation, credential-
  transience, and error mapping (`chaodays_auth_failed` 400 / `chaodays_unavailable` 502)
  as slice 1.

Backend only, diet + glucose only — no water/bowel (next slice), no frontend, no new
env/secret. Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `chaodays-import`: extends the import to chaodays diet records — food items (portions)
  into lifeos meals, and the glucose values embedded in item names into lifeos vitals —
  idempotently, without storing chaodays credentials.
