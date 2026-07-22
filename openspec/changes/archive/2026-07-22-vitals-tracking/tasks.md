# Tasks

TDD throughout: a failing vitest test first, then implementation. The
`bowel-tracking` change is the closest template (it has a jsonb-free per-day
record); the jsonb + numeric handling here follow the notes below. Run `npm test`
+ `npm run typecheck` before finishing. JSON payloads use snake_case.

## 1. Domain

- [x] 1.1 Add `src/contexts/health/domain/vitals.ts`: `BpReading { systolic:
      number, diastolic: number, pulse: number|null }`; `GlucoseReading { label:
      string, value: number }`; `Spo2Reading { spo2: number, pulse: number|null }`;
      `VitalsRecord { userId, day, weightKg: number|null, bodyFatPct: number|null,
      bpReadings: BpReading[], glucoseReadings: GlucoseReading[], spo2Readings:
      Spo2Reading[] }`.
- [x] 1.2 Add `src/contexts/health/domain/vitals-repository.ts` — `VitalsRepository`
      port: `get(userId, day)`, `set(input)` (upsert keyed by userId+day). Define
      `SetVitalsInput` (same fields as VitalsRecord).

## 2. Application use cases

- [x] 2.1 Test first (fake repo) — `getVitalsDay(repo, userId, day)`: returns the
      record mapped to a `VitalsDay` DTO (no userId); when none, the default empty
      `{ day, weightKg: null, bodyFatPct: null, bpReadings: [], glucoseReadings: [],
      spo2Readings: [] }`. Implement `src/contexts/health/application/get-vitals-day.ts`.
- [x] 2.2 Test first — `setVitalsDay(repo, input)`: upserts scalars + all three
      arrays (cover all-null scalars + empty arrays, and multiple readings in each
      list incl. a null pulse). Implement `src/contexts/health/application/set-vitals-day.ts`.

## 3. Drizzle adapter + schema + migration

- [x] 3.1 Add a `vitals` table to `src/shared/db/schema.ts`: uuid pk, `user_id`
      references `users`, `day` date, `weight_kg`/`body_fat_pct` numeric NULL, and
      three jsonb columns — `jsonb('bp_readings').$type<{ systolic: number;
      diastolic: number; pulse: number|null }[]>().notNull().default([])`,
      `glucose_readings` `$type<{ label: string; value: number }[]>()`, and
      `spo2_readings` `$type<{ spo2: number; pulse: number|null }[]>()` — plus
      `unique(userId, day)`. NOTE: `jsonb` is not yet imported in schema.ts — add it
      to the `drizzle-orm/pg-core` import; use INLINE `$type` object literals (do
      NOT import the domain types into shared/db).
- [x] 3.2 Implement `src/contexts/health/adapters/drizzle-vitals-repository.ts`
      (`DrizzleVitalsRepository`) implementing `VitalsRepository`, upsert via
      `onConflictDoUpdate`. Read/write the jsonb arrays intact. Mirror
      `drizzle-water-repository.ts` (NOT bowel) for the `numeric` columns: on write
      `weight_kg`/`body_fat_pct` → `x == null ? null : String(x)`; on read →
      `x == null ? null : Number(x)`. (integer columns don't exist here — the
      pulses live inside the jsonb.)
- [x] 3.3 Run `npm run db:generate` and commit the generated `drizzle/000X_*.sql`.

## 4. HTTP routes + wiring

- [x] 4.1 Test first — `src/adapters/http/routes/vitals.ts` handlers via app tests
      (mirror `test/adapters/http/bowel.test.ts`): `GET /api/vitals?day=` returns
      `{ day, weight_kg, body_fat_pct, bp_readings, glucose_readings, spo2_readings }`
      (defaults for an unrecorded day); `PUT /api/vitals {…}` upserts and returns it,
      with multiple readings in each array round-tripping (incl. a null pulse). Each
      requires auth and rejects a missing `day`, a non-numeric scalar, or a
      malformed reading (a non-array, or a reading that is null/primitive or missing
      a required numeric) with 400.
- [x] 4.2 Implement the route handler factories (use `resolveUserId`, `requireDay`).
      Scalars: `body.x == null ? null : requireFiniteNumber(body.x, 'x')`. Each
      array: default `[]`; reject a non-array with 400; for EACH item first guard
      `if (item == null || typeof item !== 'object') -> 400`, then validate fields —
      bp `{ systolic, diastolic: requireFiniteNumber; pulse: item.pulse == null ?
      null : requireFiniteNumber }`, glucose `{ label: typeof item.label ===
      'string' ? item.label : ''; value: requireFiniteNumber }`, spo2 `{ spo2:
      requireFiniteNumber; pulse: nullable as bp }`. Register under `authMiddleware`
      in `app.ts`; wire `DrizzleVitalsRepository` in `index.ts`.
- [x] 4.3 Making `vitalsRepository` a REQUIRED `CreateAppOptions` field forces
      updating ALL existing `createApp`/`buildApp` call sites in tests with a
      vitals-repo fake/stub: `test/adapters/http/app.test.ts`, `meals.test.ts`,
      `water.test.ts`, and `bowel.test.ts`.

## 5. Gate

- [x] 5.1 `npm test` green + `npm run typecheck` clean. No changes to existing code
      beyond additive wiring + the test call sites.
