# Tasks

## 1. Schema + migration
- [x] `shared/db/schema.ts`: add `care_item` (id, user_id→users, category text, title text,
      note text nullable, dose text nullable, stock integer nullable, stock_alert integer
      nullable, created_at), `care_schedule` (id, user_id, care_item_id→care_item cascade,
      time_of_day text, repeat_days integer[] notNull, week_interval integer notNull default
      1, start_date date notNull, end_date date nullable, dose_quantity integer notNull
      default 1, nag_interval_minutes integer notNull default 0, enabled boolean notNull
      default true, created_at). Slot key is **`local_date` (date) + `time_of_day` (text)**,
      NOT a UTC instant (D5). `care_log` (id, user_id, care_item_id, care_schedule_id,
      local_date date, time_of_day text, status text, done_time timestamptz nullable,
      dose_quantity integer notNull default 1, created_at, **unique(care_schedule_id,
      local_date, time_of_day)**); `care_occurrence` (id, user_id, care_item_id,
      care_schedule_id, local_date date, time_of_day text, last_notified_at timestamptz
      nullable, created_at, **unique(care_schedule_id, local_date, time_of_day)**). **Drop**
      `reminder_schedule` + `reminder_occurrence`. Generate migration.

## 2. Domain: entities + ports
- [x] `domain/care-item.ts`: `CareItem` { id, userId, category, title, note?, dose?, stock?,
      stockAlert? } + `CareSchedule` { id, careItemId, timeOfDay, repeatDays, weekInterval,
      startDate, endDate?, doseQuantity, nagIntervalMinutes, enabled }. `CareItemRepository`
      port — `create(item + schedules)`, `listByUser(userId, category?)`, `get(id)`,
      `update(id, userId, patch incl. schedules)`, `delete(id, userId)`, and
      **`listActiveSchedules()` → `{ item, schedule, timezone }[]`** (enabled schedules joined
      with item + owner tz, for the tick).
- [x] `domain/care-log.ts`: `CareLog` + `CareLogRepository` (`upsert` by (scheduleId,
      scheduledTime), `getBySlot`, `listMissingLogsBefore(localStartOfToday)` helper as needed).
- [x] `domain/care-occurrence.ts`: `CareOccurrence` + repo (`upsertBySlot` returning the row
      incl. last_notified_at, `touchNotified(id, at)`, `listPastWithoutLog(...)` for markMissed).

## 3. Use case: care-item CRUD (TDD, in-memory repo)
- [x] `application/care-items.ts`: create/list/update/delete, schedules inline; validate
      `category` ∈ set, `time_of_day` HH:mm, each `repeat_days` 0-6, `week_interval` ≥ 1,
      `start_date`/`end_date` real dates with end ≥ start, `nag_interval_minutes` ≥ 0,
      `dose_quantity` ≥ 1, optional `stock`/`stock_alert` ≥ 0 → `InvalidCareItemError`.
      Owner-scoped update/delete. Test each validation + owner scoping.

## 4. Use case: answer-care-slot (TDD)
- [x] `application/answer-care-slot.ts`: `answerCareSlot(repos, userId, { scheduleId,
      localDate, timeOfDay, status })` → upsert `care_log` on the slot key. **Decrement stock
      only on the transition INTO done** (prior log absent or non-done) for a `medication`
      item with non-null `stock`, by `dose_quantity`, clamp ≥ 0. A re-answer when a log
      already exists is a **no-op returning the existing log** (no double-decrement, no
      status change this slice). `skipped` = no stock change. Owner-scoped. Tests: first done
      decrements; second done does NOT decrement again; non-medication done no stock; skipped
      no stock; clamp at 0; re-answer no-op.

## 5. Use case: run-care-tick (TDD, fakes + fixed now)
- [x] `application/run-care-tick.ts`: `listActiveSchedules()` → for each, resolve local
      date/weekday/HH:mm (reuse `reminder-clock`); active-day gate (empty repeat_days = every
      day; weekday; week-interval; start/end range); midnight-safe absolute-minute look-back
      (Slice-2 D3) → upsert `care_occurrence` (scheduled_time = slot's UTC instant). Then nag:
      if no `care_log` for the slot and (last_notified_at null OR now−last_notified_at ≥
      nag_interval_minutes) and slot within local day → send push (title=item.title, body=note
      or dose summary) to the user's subscriptions, `touchNotified`; expired 404/410 → delete
      subscription. Re-nag branch gated on `nag_interval_minutes > 0` so **interval=0 fires
      once** (D4). Look-back is **today-local only** (no cross-midnight delivery). markMissed:
      occurrences with `local_date` **strictly before** today-local and no log → insert a
      `missed` log with **onConflictDoNothing** (don't clobber a concurrent HTTP answer, D7).
      Per-occurrence try/catch isolation. Tests: due→fire; every-day(empty repeat_days);
      weekday/week-interval/date-range gating; dedupe/double-tick no double-send; **interval=0
      second tick does NOT re-send**; re-nag only after interval elapsed; a care_log stops the
      nag; **a slot unanswered before midnight is marked missed next day, not double-fired**;
      markMissed onConflictDoNothing leaves an existing done/skipped log intact; per-user tz;
      per-occurrence isolation.

## 6. Adapters (Drizzle)
- [x] `adapters/drizzle-care-item-repository.ts` — create/list/get/delete +
      **update that upserts schedules BY id** (update existing, insert new, delete only omitted
      — preserves care_log/care_occurrence FK rows, D2) + `listActiveSchedules` join with
      users.timezone. `drizzle-care-log-repository.ts` (upsert / insert-if-absent on the slot
      key). `drizzle-care-occurrence-repository.ts` (`upsertBySlot` via onConflictDoNothing on
      the unique `(care_schedule_id, local_date, time_of_day)` key). Follow the existing
      `Drizzle*Repository` pattern.

## 7. Routes + wiring
- [x] `routes/care.ts`: `POST/GET/PATCH/DELETE /api/care/items` (schedules inline, snake_case,
      `resolveUserId`, validation → 400) and `POST /api/care/log`
      { care_schedule_id, local_date, time_of_day, status }. Route tests (workers project) per D "Testing".
- [x] `app.ts`: add the care repositories to `CreateAppOptions`, register routes under
      `authMiddleware`; **remove** the `/api/reminders/medication` routes.
- [x] `index.ts`: `buildDeps` gains the care repositories; `scheduled` calls
      `ctx.waitUntil(runCareTick(new Date(), deps))` **instead of** `runReminderTick`.

## 8. Remove the Slice-2 flat model
- [x] Delete `reminder-schedule.ts`, `reminder-occurrence.ts`, `medication-reminders.ts`,
      `run-reminder-tick.ts`, their Drizzle repos, `routes/reminders.ts`, and their tests.
      Ensure nothing else imports them. (Keep `reminder-clock.ts` — reused.)

## 9. Gate
- [x] `npm test` + `npm run typecheck` green.
