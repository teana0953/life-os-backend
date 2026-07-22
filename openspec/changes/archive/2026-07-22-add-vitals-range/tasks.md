# Tasks

TDD throughout: a failing vitest test first, then implementation. This is
**additive** to the existing vitals context (a new repo read + a pure series
helper + a use case + a route) — NO schema change, NO migration, NO new
`CreateAppOptions` field. Run `npm test` + `npm run typecheck` before finishing.
JSON payloads use snake_case.

## 1. Domain

- [x] 1.1 Add `getLatestWeight`-style additive method `listRange(userId, from, to):
      Promise<VitalsRecord[]>` to the `VitalsRepository` port
      (`src/contexts/health/domain/vitals-repository.ts`) — records with day in
      `[from, to]`, ascending by day.
- [x] 1.2 Add the pure series helper `src/contexts/health/domain/vitals-series.ts`
      (domain, no outer imports): `Point { day, value }`,
      `VitalsSeries { weight, bodyFat, systolic, diastolic, pulse, glucose, spo2 }`
      (each `Point[]`), and `buildVitalsSeries(records)` (records ascending):
      weight/bodyFat from the scalar (skip null days, 1 decimal); systolic/diastolic
      = daily mean of bpReadings (rounded); pulse = daily mean of every non-null
      pulse across bpReadings + spo2Readings (rounded); glucose = daily mean of
      glucoseReadings.value (rounded); spo2 = daily mean of spo2Readings.spo2
      (rounded); an empty/all-null metric contributes no point for that day. Test
      first with the spec's worked examples (weight two points skipping the empty
      day; bp 118/76+122/80 → 120/78; pulse 70+74 → 72; empty metric → empty series).

## 2. Application use case

- [x] 2.1 Test first (fake repo) — `getVitalsRange(vitalsRepo, userId, from, to)`:
      returns `VitalsRangeOverview { from, to, series }` where series =
      `buildVitalsSeries(await vitalsRepo.listRange(userId, from, to))`. Implement
      `src/contexts/health/application/get-vitals-range.ts`.

## 3. Drizzle adapter

- [x] 3.1 Implement `listRange` in `DrizzleVitalsRepository`
      (`src/contexts/health/adapters/drizzle-vitals-repository.ts`): select the
      user's rows where `day >= from AND day <= to`, ordered by `day` asc, mapped to
      `VitalsRecord` via the existing row→domain mapping (numeric → `Number()`, the
      jsonb reading arrays as-is). Additive — no change to existing methods.

## 4. HTTP route + wiring

- [x] 4.1 Test first — `GET /api/vitals/range?from=&to=` handler via app tests
      (mirror `test/adapters/http/vitals.test.ts`): returns `{ from, to, series:
      { weight, body_fat, systolic, diastolic, pulse, glucose, spo2 } }` (each a
      list of `{ day, value }`) for the records in range; requires auth; rejects a
      missing/invalid `from`/`to` and a `from` later than `to` with 400.
- [x] 4.2 Implement `createGetVitalsRangeHandler` (in `routes/vitals.ts` or a new
      route file): `resolveUserId`; `from`/`to` via `requireDay`; `from > to` throws
      `BadRequestError` → 400. Map the series to snake_case (`body_fat`, and each
      point `{ day, value }`). Register `GET /api/vitals/range` in
      `src/adapters/http/app.ts` under `authMiddleware`, reusing the existing
      `vitalsRepository` (NO new `CreateAppOptions` field). **Add `listRange` to
      EVERY fake `VitalsRepository` in the tests** so typecheck stays green — grep
      `implements VitalsRepository` and `VitalsRepository = {` across `test/`
      (the app-construction stubs AND any application-layer fakes) and give each a
      `listRange`.

## 5. Gate

- [x] 5.1 `npm test` green + `npm run typecheck` clean. Additive only — no schema/
      migration, no change to existing vitals behaviour beyond the new read.
