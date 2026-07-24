# Design — Medication reminders + Cron scheduler

## Context & scope

Slice 2 of reminders: the scheduling core (schedule + occurrence + per-minute Cron
dispatch) plus the first schedule kind, medication. It builds on Slice 1's live push
delivery (`push_subscription`, `PushSender`/`WebPushSender` in the `notifications`
context). Rehab/glucose/missed-meal are later slices that reuse this core. Frontend
config UI is a later slice.

## Architecture

Everything lands in the existing `src/contexts/notifications/` context (it already
owns push delivery — keeping scheduling here avoids a cross-context port dependency):

```
domain/
  reminder-schedule.ts     # ReminderSchedule entity + ReminderScheduleRepository port
  reminder-occurrence.ts   # ReminderOccurrence entity + ReminderOccurrenceRepository port
  reminder-clock.ts        # pure tz helpers: localParts(now, tz) -> {date,'HH:mm',weekday}; weeksSince(anchor, localDate)
application/
  medication-reminders.ts  # create/list/update/delete use cases
  run-reminder-tick.ts     # materialize due occurrences + dispatch (the cron body)
adapters/
  drizzle-reminder-schedule-repository.ts
  drizzle-reminder-occurrence-repository.ts
```

`shared/db/schema.ts` gains `users.timezone`, `reminder_schedule`, `reminder_occurrence`.
`index.ts` gains a `scheduled` handler; `wrangler.toml` gains the cron trigger. Routes
under `src/adapters/http/routes/reminders.ts` + `user-timezone` handler.

## Key decisions

- **D1 — Detect the current minute, don't pre-materialize the future.** The cron runs
  every minute. `runReminderTick(now)` computes, per active schedule, the user's local
  `HH:mm`/weekday/date via `Intl.DateTimeFormat`. A `times` entry "fires" when it equals
  the current local `HH:mm`. This sidesteps all local→UTC conversion (and DST) — we
  never convert a schedule time to a UTC instant; we compare local wall-clock strings.
  `due_at` on the occurrence is simply `now` (the cron instant).

- **D2 — `dedupe_key` = `\`${schedule_id}|${localDate}|${HH:mm}\``, upsert-if-absent.**
  Guarantees exactly one occurrence (and one push) per schedule/day/time even if the
  tick runs twice or the look-back re-sees a time. `upsertByDedupeKey` inserts only when
  absent (unique constraint on `dedupe_key`).

- **D3 — Look-back computed on absolute local minutes (midnight-safe).** Cloudflare cron
  is not a hard real-time guarantee; a tick can be skipped. For each schedule time we
  form the candidate's **local datetime** (the schedule's `HH:mm` on the current local
  date, and — because a tick just after midnight must still catch a 23:5x time from
  "yesterday" — also on the previous local date) and fire it when its absolute local
  minute falls within `[nowLocalMinute - LOOKBACK_MINUTES, nowLocalMinute]`
  (`LOOKBACK_MINUTES` e.g. 5). The `dedupe_key` date is the **fired candidate's local
  date, not `now`'s**, so a 23:5x reminder recovered at 00:0x keys to the correct
  (previous) day. Comparisons are on minute integers, never on `HH:mm` strings. A time
  older than the look-back window is simply never materialized — a long outage drops
  those reminders rather than firing a late burst; acceptable, and the drop is
  observable via the absent occurrence, not silent success.

- **D4 — Recurrence (anchor-relative weeks).** Active-day test: `days_of_week` includes
  the local weekday AND `weeksSince(anchor_date, localDate) % week_interval === 0`.
  `weeksSince` = `floor(daysBetween(anchor_date, localDate) / 7)` — whole **anchor-relative**
  7-day windows (NOT calendar weeks), ≥ 0; a future anchor → negative → not yet active
  (skip). `week_interval = 1` (default) → every selected weekday. The spec states the
  week is anchor-relative so a multi-weekday + interval>1 schedule is unambiguous.

- **D5 — Dispatch reuses Slice 1 delivery; a distinct `failed` terminal status.** After
  materializing, `listDuePending(now)` (status=pending, due_at<=now) → for each, load the
  user's `push_subscription`s and send `{ title: label, body }` via `PushSender`.
  Terminal status: `sent` if **at least one** send succeeded; `skipped` if the user has
  **no** subscriptions; **`failed`** if there were subscriptions but **every** send
  failed (a transient push/network error). `failed` (vs mislabeling it `sent`) keeps a
  genuinely-lost medication reminder observable and gives a later retry hook a target —
  this slice does not retry. On a `PushSender` result of `expired` (404/410), delete that
  subscription (same pruning as `sendTestPush`). The occurrence is always marked terminal
  so it never double-sends.

- **D6 — Exactly-once rests on cron non-concurrency.** `dedupe_key` (unique, upsert-if-
  absent) guarantees exactly one occurrence ROW per schedule/day/time, and sequential
  repeated/look-back ticks are safe because each `markSent`s before the next runs. It does
  NOT provide an atomic dispatch claim, so exactly-once *delivery* additionally relies on
  Cloudflare not running concurrent invocations of a single cron trigger (it doesn't). No
  DB-level `SELECT ... FOR UPDATE SKIP LOCKED` claim is added for this slice.

- **D6b — Timezone plumbing (no per-schedule N+1).** `users` gains a `timezone` column.
  `ReminderScheduleRepository.listActiveAll()` returns each active schedule **joined with
  its owner's `timezone`** (`{ schedule, timezone }`), so `runReminderTick` needs no
  per-schedule user lookup. `PUT /api/user/timezone` writes via a new
  `UserRepository.updateTimezone(userId, tz)`; the existing `User` entity/`getOrCreate`
  gains a `timezone` field (default `Asia/Taipei`) so reads carry it.

- **D7 — `scheduled` handler composition.** `index.ts` currently exports `{ fetch }`.
  Add `scheduled(event, env, ctx)` that builds the same lazy DB + repositories +
  `WebPushSender` (from the VAPID env) as `fetch`, and `ctx.waitUntil(runReminderTick(new
  Date(), { scheduleRepo, occurrenceRepo, subscriptionRepo, pushSender, userRepo }))`.
  Factor the shared wiring so `fetch` and `scheduled` don't drift.

- **D8 — Timezone validation.** `PUT /api/user/timezone` validates the IANA name by
  attempting `new Intl.DateTimeFormat(undefined, { timeZone })` in a try/catch (throws
  `RangeError` on an unknown zone → `BadRequestError` → 400).

## Testing

- **`reminder-clock.ts` (unit)**: `localParts` for a known UTC instant in
  `Asia/Taipei` (and one other zone) returns the right date/HH:mm/weekday; `weeksSince`
  across week boundaries and with a future anchor.
- **`run-reminder-tick.ts` (unit)** with fake repos + fake `PushSender` + a fixed
  `now`: a time matching the current local minute materializes exactly one occurrence
  and dispatches it; running the tick twice does NOT double-send (dedupe); an inactive
  weekday / off week-interval / future anchor / disabled schedule fires nothing; the
  look-back materializes a just-missed time once; a user with no subscription →
  `skipped`; an `expired` send deletes that subscription; a schedule with several
  users/times behaves per-user in each tz.
- **CRUD + timezone routes (workers project)**: create/list/update/delete medication
  reminders (401 unauth; 400 on bad `times`/`days_of_week`/`week_interval`/`anchor_date`
  or a non-owner id); `PUT /api/user/timezone` 200 on a valid zone, 400 on an invalid one.
- **Not unit-tested (Cloudflare-only)**: the actual Cron trigger firing — verified on
  deploy by scheduling a reminder a few minutes out and confirming the device receives it.
