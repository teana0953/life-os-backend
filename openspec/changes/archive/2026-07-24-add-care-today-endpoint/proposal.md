## Why

The Today checklist UI (Slice C2) needs today's care slots with their status. Computing
"today's slots" requires the user's set timezone + the recurrence rules — which live on the
**backend** (`users.timezone`, `isActiveOn`, `reminder-clock`), and are authoritative (the
device timezone may differ from the user's set one). So this adds a read-only
`GET /api/care/today` that expands today's active schedules into status-tagged slots.

## What Changes

- **`GET /api/care/today`** (authenticated) → `{ date: '<today local YYYY-MM-DD>', items: [...] }`.
  For each of the user's **enabled** schedules **active today** (empty repeat_days = every day /
  weekday selected, week-interval on, within start/end — reusing Slice-A `isActiveOn`), one slot:
  `{ care_item_id, care_schedule_id, category, title, note, dose (medication, nullable),
  time_of_day, local_date, status, done_time (nullable), dose_quantity }`, ordered by time.
- **Status** (computed at request time in the user's local time, no writes): if a `care_log`
  exists for `(schedule, local_date, time_of_day)` → its status (`done`/`skipped`/`missed`) +
  `done_time`; else if the local time is past the slot's `time_of_day` → `overdue`, else
  `pending`. (`missed` is only ever written by the Cron's markMissed; this endpoint just
  reflects existing logs.)
- **`getCareToday`** use case: read the user's timezone, resolve the local date
  (`reminder-clock`), list the user's active-today schedules (joined with item
  title/category/note/dose), batch-read today's `care_log`s, and assemble the ordered items.
  `now` is injectable for tests.

Backend only, read-only (no writes; no Cron change; no next-reminder time — deferrable). Gate =
`npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `care-reminders`: gains a today's-slots read view — the user can fetch today's due care slots
  (in their timezone) each tagged with its status (pending / overdue / done / skipped / missed),
  for a daily checklist.
