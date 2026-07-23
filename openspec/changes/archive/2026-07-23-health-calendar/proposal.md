## Why

Feature C's dashboard needs a **monthly record calendar** (which days the user
logged anything) and **adherence rings** (how consistently they logged and hit
their diet targets this month). Today nothing aggregates activity across the
trackers. This adds a month summary endpoint powering the C3 calendar + rings.

## What Changes

- **`HealthCalendarRepository`** (new domain port) + Drizzle adapter:
  `listLoggedDays(userId, from, to)` returns the distinct days in `[from, to]` that
  have **any** entry across the day-keyed trackers — meals, water, bowel, exercise,
  and vitals (a union of their `day` columns). Read-only; touches no existing repo.
- **`getHealthCalendar`** use case → a month summary:
  - `loggedDays`: the month's logged days (for the calendar dots).
  - `daysElapsed`: days counted so far — the day-of-month for the current month, the
    full month for a past month, 0 for a future month.
  - `loggingRate`: `round(100 × loggedDays / daysElapsed)` (0–100), null when
    `daysElapsed` is 0.
  - `dietAdherenceRate`: the share of elapsed days that **met the diet target** —
    a day counts as met when it has a target (effective portions > 0) and every
    category is fully logged (remaining ≤ 0), reusing
    `getDailyTargetWithRemaining`. `round(100 × met / daysElapsed)`, null when
    `daysElapsed` is 0.
- **`GET /api/health-calendar?month=YYYY-MM`** (authenticated): returns
  `{ year, month, logged_days, days_elapsed, logging_rate, diet_adherence_rate }`.
  A missing/malformed `month` is a 400.

The third C3 ring — **weight-goal achievement** — is not added here; the client
reuses the existing `/api/weight-goal`. Backend only. Gate = `npm test` +
`npm run typecheck`.

## Capabilities

### Added Capabilities

- `health-calendar`: a monthly summary of which days the user logged any tracker
  activity, plus a logging rate and a diet-adherence rate over the elapsed days of
  the month.
