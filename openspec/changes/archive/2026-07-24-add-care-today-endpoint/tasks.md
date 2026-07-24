# Tasks

## 1. Shared active-day predicate (no drift)
- [x] Ensure `isActiveOn(schedule, localDate)` is a shared function (extract from
      `run-care-tick.ts` if it lives there, e.g. into `domain/care-schedule.ts`) so both the tick
      and the today endpoint use the same predicate. Update `run-care-tick` to import it. Existing
      tick tests must stay green.

## 2. Repository additions
- [x] `CareItemRepository.listActiveSchedulesForUserOn(userId, localDate)` (or `listSchedulesWithItem`)
      → each enabled schedule for the user joined with its item's `category`/`title`/`note`/`dose`
      (+ the schedule fields incl. dose_quantity). Filter to active-today via the shared `isActiveOn`
      (in SQL or in memory). `CareLogRepository.listByUserAndDate(userId, localDate)` → the user's
      logs for that local date. Implement in the Drizzle adapters + the in-memory fakes.

## 3. Use case: getCareToday (TDD)
- [x] `application/get-care-today.ts`: `getCareToday(deps, userId, now)` → read tz (UserRepository),
      `localParts(now, tz)` → localDate + now's local minute; list active-today schedules; batch-read
      today's logs indexed by (scheduleId, time_of_day); for each slot derive status (log status +
      done_time, else overdue/pending by local-minute compare); return `{ date: localDate, items }`
      ordered by time_of_day. Tests per design "Testing".

## 4. Route + wiring
- [x] `routes/care.ts`: `GET /api/care/today` handler (`resolveUserId`, calls `getCareToday(deps,
      userId, new Date())`, returns the envelope). `app.ts`: register under `authMiddleware` (deps
      already in CreateAppOptions). Route test: 200 `{date, items}` shape, 401 unauth, owner-scoped.

## 5. Gate
- [x] `npm test` + `npm run typecheck` green.
