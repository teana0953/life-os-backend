## Why

Third and simplest slice of "import from chaodays": water and bowel — plain
structured data. Reuses the connector from slices 1–2. With this, the backend can
import all six chaodays data types; slice 4 is the frontend UI.

## What Changes

- **`ChaodaysClient`** gains `fetchWaterRecords` and `fetchDefecationRecords`
  (+ `HttpChaodaysClient` impls, same devise_token_auth / envelope / rotation /
  malformed-→-502 pattern as the existing fetches).
- **`importChaodaysWater`** (WaterRepository + ChaodaysClient): sums each day's
  chaodays water entries and, for a day with no existing lifeos intake, adds that
  day's total (a day that already has intake is skipped — water intake is additive,
  so this both avoids clobbering the user's data and makes re-import idempotent).
  Returns `{ imported, skipped, from, to }` (per day).
- **`importChaodaysBowel`** (BowelRepository + ChaodaysClient): aggregates each day's
  defecation records — count = sum, `isNormal = !(any is_abnormality)` (chaodays
  records abnormality, lifeos records normality — the flag is inverted), note =
  joined non-empty notes — and sets it for a day that has no existing lifeos bowel
  log (else skipped). Returns `{ imported, skipped, from, to }`.
- **`POST /api/import/chaodays/water`** and **`POST /api/import/chaodays/bowel`**
  (authenticated): body `{ chaodays_uid, chaodays_password, start_date, end_date }`
  → summary. Same credential-transience, validation, and error mapping
  (`chaodays_auth_failed` 400 / `chaodays_unavailable` 502) as before.

Backend only, water + bowel only — no frontend (slice 4), no new env/secret. Gate =
`npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `chaodays-import`: extends the import to chaodays water (summed per day into lifeos
  intake) and bowel records (aggregated per day, abnormality flag inverted),
  idempotently skipping days that already have lifeos data.
