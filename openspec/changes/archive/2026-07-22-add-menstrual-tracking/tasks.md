# Tasks

TDD throughout: a failing vitest test first, then implementation. Follow the
existing health-context patterns — `add-exercise-tracking` is the closest recent
template (a per-user list of records with add/delete + a computed read DTO), but
this one also has PATCH (edit) and derived statistics. Run `npm test` +
`npm run typecheck` before finishing. JSON payloads use snake_case. Dates are ISO
`YYYY-MM-DD` strings; day-count math uses UTC pure-date arithmetic (no
Duration-on-instant, to avoid DST drift).

## 1. Domain

- [x] 1.1 Add `src/contexts/health/domain/menstrual-period.ts`:
      `MenstrualPeriod { id, userId, startDate, endDate: string | null }` (ISO day
      strings).
- [x] 1.2 Add `src/contexts/health/domain/menstrual-repository.ts` — the
      `MenstrualRepository` port: `add(input)`, `listByUser(userId)` (ascending by
      startDate), `update(userId, id, patch)` (owned-only; returns the updated
      `MenstrualPeriod` or null when not owned/found), `delete(userId, id)`
      (owned-only boolean). Define `AddPeriodInput { userId, startDate, endDate }`
      and `UpdatePeriodPatch { startDate?: string; endDate?: string | null }` — a
      **partial update**: an absent field (undefined) means "keep", `endDate: null`
      means "clear the end date", a string sets it. `update` applies ONLY the
      fields present on the patch.
- [x] 1.3 Add the statistics as a pure, unit-testable helper (e.g.
      `src/contexts/health/domain/menstrual-stats.ts`): given periods sorted by
      startDate, compute `{ averageCycleDays, averagePeriodDays, predictedNextStart }`.
      `averageCycleDays` = mean gap (days) between consecutive start dates over the
      most recent N=6 intervals, rounded to an integer, null when <2 periods.
      `averagePeriodDays` = mean of `end − start + 1` over completed periods
      (endDate non-null), rounded, null when none completed. `predictedNextStart` =
      last start + averageCycleDays days (ISO day), null when averageCycleDays is
      null. Test first with the spec's worked example (2026-05-01/05-29/06-26 → 28
      days, predicted 2026-07-24) plus the null-data cases.

## 2. Application use cases

- [x] 2.1 Test first (fake repo) — `addPeriod(repo, input)`: stores and returns;
      rejects (throws a domain error) when `endDate` is non-null and earlier than
      `startDate`. Implement `src/contexts/health/application/add-period.ts`.
- [x] 2.2 Test first — `updatePeriod(repo, userId, id, patch)`: finds the owned
      period (null when not owned/found), merges ONLY the patch's present fields
      onto it (an absent field keeps the current value; `endDate: null` clears it),
      validates the merged `endDate == null || endDate >= startDate` (throws on
      violation), then updates; returns the updated period. Test the partial-update
      cases explicitly: patching only `endDate` keeps the existing `startDate`;
      patching only `startDate` does NOT wipe the existing `endDate`. Implement
      `src/contexts/health/application/update-period.ts`.
- [x] 2.3 Test first — `deletePeriod(repo, userId, id)`: returns true when the
      owned period is deleted, false otherwise. Implement
      `src/contexts/health/application/delete-period.ts`.
- [x] 2.4 Test first — `getMenstrualOverview(repo, userId)`: returns
      `MenstrualOverview { periods (ascending), stats, lastPeriod }`; empty user →
      empty periods, all-null stats, null lastPeriod; multiple periods → sorted
      list + computed stats (reuse the 1.3 helper) + lastPeriod (max startDate).
      Implement `src/contexts/health/application/get-menstrual-overview.ts`.

## 3. Drizzle adapter + schema + migration

- [x] 3.1 Add a `menstrualPeriod` table to `src/shared/db/schema.ts` (uuid pk,
      `user_id` references `users`, `start_date` date, `end_date` date nullable,
      `created_at` timestamp default now, index on `(user_id, start_date)` — NO
      unique constraint).
- [x] 3.2 Implement `src/contexts/health/adapters/drizzle-menstrual-repository.ts`
      (`DrizzleMenstrualRepository`) implementing `MenstrualRepository`: `add`
      inserts+returns; `listByUser` selects by user ordered by `start_date` asc;
      `update` updates by `(id, user_id)` with only the provided patch fields and
      returns the row (or null via `.returning()` length); `delete` deletes by
      `(id, user_id)` returning whether a row was removed.
- [x] 3.3 Run `npm run db:generate` and commit the generated `drizzle/000X_*.sql`.

## 4. HTTP routes + wiring

- [x] 4.1 Test first — `src/adapters/http/routes/menstrual.ts` handlers via app
      tests (mirror `test/adapters/http/exercise.test.ts`):
      `GET /api/menstrual` returns `{ periods, stats, last_period }` (empty/null for
      a user with none); `POST /api/menstrual { start_date, end_date? }` adds and
      returns `{id, start_date, end_date}`; `PATCH /api/menstrual/:id
      { start_date?, end_date? }` updates and returns it (404 `{error:'not_found'}`
      for another user's / unknown id); `DELETE /api/menstrual/:id` returns
      `{deleted}` (false for another user's id). Each requires auth; writing rejects
      a missing `start_date` and an `end_date` earlier than `start_date` (400).
- [x] 4.2 Implement the route handler factories (use `resolveUserId`). **POST**:
      `start_date` via `requireDay`; `end_date` optional — `typeof body.end_date ===
      'string' ? requireDay(body.end_date, 'end_date') : null` (NOT a helper that
      rejects empties). **PATCH — build the patch by KEY PRESENCE** (mirror
      `meals.ts:createUpdateMealItemHandler`, do NOT reuse the POST pattern):
      `if ('start_date' in body) patch.startDate = requireDay(body.start_date,
      'start_date')`; `if ('end_date' in body) patch.endDate = typeof body.end_date
      === 'string' ? requireDay(body.end_date, 'end_date') : null` — an ABSENT
      `end_date` must NOT become null (that would silently wipe the stored end
      date). The `end < start` check (on the merged value, in the use case) throws
      `BadRequestError` → 400; unknown/not-owned PATCH → `c.json({error:'not_found'},
      404)`, DELETE → `{deleted:false}`. Register the four
      routes in `src/adapters/http/app.ts` under `authMiddleware`, and wire a
      `DrizzleMenstrualRepository` in `src/index.ts`. Making `menstrualRepository` a
      REQUIRED field of `CreateAppOptions` forces updating ALL SIX existing
      app-construction call sites in tests with a menstrual-repo fake/stub so
      typecheck + tests stay green: `test/adapters/http/app.test.ts`,
      `water.test.ts`, `bowel.test.ts`, `vitals.test.ts`, `exercise.test.ts`, AND
      `meals.test.ts`.

## 5. Gate

- [x] 5.1 `npm test` green + `npm run typecheck` clean. No changes to existing code
      beyond additive wiring in `app.ts`/`index.ts` + the test call sites.
