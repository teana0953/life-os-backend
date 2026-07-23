# Tasks

TDD. `npm test` + `npm run typecheck` before finishing. Snake_case at the boundary.

## 1. Logged-days port + adapter
- [x] 1.1 `domain/health-calendar-repository.ts`: `HealthCalendarRepository` with
      `listLoggedDays(userId, from, to): Promise<string[]>`.
- [x] 1.2 `adapters/drizzle-health-calendar-repository.ts`: distinct `day` across
      meal_entry / water_intake / bowel_log / exercise_log / vitals in `[from, to]`
      (5 `selectDistinct` unioned in memory), sorted ascending.

## 2. Use case
- [x] 2.1 Test first `application/get-health-calendar.test.ts`: logged days union;
      days_elapsed (current = day-of-month; past = days-in-month; future = 0);
      logging_rate; diet_adherence_rate (met = target set & all remaining ≤ 0), with
      an injected `today`; rates null when elapsed is 0.
- [x] 2.2 `application/get-health-calendar.ts`: `getHealthCalendar(calendarRepo,
      dailyTargetRepo, mealRepo, userId, year, month, today)` → summary. Reuse
      `getDailyTargetWithRemaining` per elapsed day (Promise.all).

## 3. Route
- [x] 3.1 Test first `test/adapters/http/health-calendar.test.ts`: 200 shape;
      malformed/missing month → 400; unauth → 401.
- [x] 3.2 `routes/health-calendar.ts` + wire in `app.ts` (`GET /api/health-calendar`)
      and `index.ts` (new `DrizzleHealthCalendarRepository`, options). `today` from
      the server clock (UTC date).

## 4. Gates
- [x] 4.1 `npm test` green, `npm run typecheck` clean.
