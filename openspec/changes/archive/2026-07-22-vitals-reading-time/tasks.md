# Tasks

TDD throughout: a failing vitest test first, then implementation. Run `npm test`
+ `npm run typecheck` before finishing. No schema/migration (jsonb is
schemaless). JSON snake_case.

## 1. Domain types

- [x] 1.1 `src/contexts/health/domain/vitals.ts`: add `time: string` (HH:mm) to
      `BpReading`, `GlucoseReading`, and `Spo2Reading`.
- [x] 1.2 Widen the three jsonb `$type<...>()` annotations in
      `src/shared/db/schema.ts` (the `vitals` table's `bp_readings`/
      `glucose_readings`/`spo2_readings` columns) to include `time: string` in each
      inline literal. This is a **compile-time annotation only — NOT a migration**
      (jsonb is schemaless); without it the read coerce's `r.time` access and the
      `toDomain` array assignment won't typecheck.

## 2. Route validation (PUT requires a time; reads tolerant)

- [x] 2.1 Test first (route/app tests, mirror the existing vitals.test.ts): a PUT
      whose reading includes `time` round-trips it back on each of the three lists;
      a PUT with a reading missing `time` (or an empty `time`) is rejected with
      400.
- [x] 2.2 Implement in `src/adapters/http/routes/vitals.ts`: in each per-reading
      validator (bp/glucose/spo2), add `time: requireString(item.time,
      '<list>[<i>].time')` (`requireString` already rejects a missing/empty string,
      giving the required-time behavior). Import `requireString` from
      `../validation` if not already.

## 3. Read tolerance for legacy data

- [x] 3.1 Test first — `getVitalsDay` / the drizzle read of a stored reading that
      has NO `time` field returns that reading with `time: ''` (older data must not
      break). Implement in `src/contexts/health/adapters/drizzle-vitals-repository.ts`:
      when mapping the jsonb arrays on read, coerce each reading's time with
      `time: typeof r.time === 'string' ? r.time : ''`.

## 4. Update existing tests + gate

- [x] 4.1 Update every existing reading fixture that a test PUTs or constructs
      (in test/adapters/http/vitals.test.ts and test/contexts/health/application/
      vitals.test.ts, plus any vitals-repo stubs used elsewhere) to include a
      `time` (e.g. "08:30"), so the now-required field doesn't fail validation or
      typecheck.
- [x] 4.2 `npm test` green + `npm run typecheck` clean.
