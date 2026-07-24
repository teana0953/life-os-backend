# Design — GET /api/care/today

## Context & scope

Slice C1: a read-only endpoint returning today's care slots + status, for the Slice-C2 Today
checklist. Reuses the Slice-A care model, `reminder-clock`, and `isActiveOn`. No writes, no Cron
change. `POST /api/care/log` (answering a slot) already exists.

## Architecture

In `src/contexts/notifications/`:
```
application/get-care-today.ts   # the use case
```
+ a `GET /api/care/today` handler in `routes/care.ts`, wired in `app.ts` (deps already present:
UserRepository for timezone, CareItemRepository, CareLogRepository). The
slot-active + weekday logic is the same `isActiveOn` used by `run-care-tick` — **extract it to a
shared helper** (e.g. `domain/care-schedule.ts` or reuse the tick's) so the tick and this endpoint
can't drift.

## Key decisions

- **D1 — Status is derived, never written.** `getCareToday(deps, userId, now)`: resolve the
  user's tz + local date via `reminder-clock.localParts(now, tz)`. For each active-today schedule,
  the slot key is `(schedule, localDate, time_of_day)`. Look up its `care_log`: present → its
  status + done_time; absent → compare the slot's local minute to now's local minute → `overdue`
  (slot ≤ now) / `pending` (slot > now). `missed` only ever comes from an existing log (Cron).
  **Note: for a TODAY-scoped view `missed` is defensive pass-through only** — the Cron's
  markMissed marks only strictly-past-local-day slots, so a `missed` log always has
  `local_date < today` while this endpoint reads only `local_date == today`; a today slot is
  never surfaced as `missed` in practice. The code still passes any log's status through
  (future-proof), and a unit test covers that pass-through via a fake — but no assertion should
  imply the today endpoint itself produces `missed`.

- **D2 — One batch log read.** Fetch all of the user's `care_log`s for today's `local_date` once
  (`CareLogRepository.listByUserAndDate(userId, localDate)` — add if absent) and index by
  `(schedule_id, time_of_day)`, avoiding an N+1 per slot.

- **D3 — Active-today schedule list joined with item fields.** Add
  `CareItemRepository.listActiveSchedulesForUserOn(userId, localDate)` (or reuse `listByUser` +
  filter with the shared `isActiveOn`), returning each active schedule with its item's
  category/title/note/dose so the endpoint needs no second per-item read. Ordering: by
  `time_of_day` (stable, e.g. then by title).

- **D4 — Reuse `isActiveOn` (no drift).** The endpoint MUST use the exact same active-day predicate
  as `run-care-tick` (empty repeat_days = every day; weekday ∈ repeat_days; weeksSince(start) %
  week_interval == 0; start ≤ localDate ≤ end). Extract it to a shared function if it currently
  lives inside `run-care-tick`.

- **D5 — Envelope `{ date, items }`.** `date` = today's local date; `items` ordered by time. Empty
  → `{ date, items: [] }`. snake_case throughout.

## Testing

- **`get-care-today.ts` (unit, fake repos + fixed now)**: an active-today schedule appears; a
  schedule inactive today (wrong weekday / off week-interval / out of date range / disabled) is
  absent; a slot with a `done`/`skipped`/`missed` log reflects that status + done_time; a logless
  slot past its time → `overdue`, before → `pending`; multiple items/schedules ordered by time;
  empty → `{date, items:[]}`; the user's timezone drives both the local date and the overdue/pending
  boundary (a two-timezone case where the same instant yields different local date/status).
- **Route (workers project)**: 200 shape (`{date, items}`), 401 unauth, results scoped to the caller.
