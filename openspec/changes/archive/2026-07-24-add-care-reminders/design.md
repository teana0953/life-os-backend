# Design — Generic care reminders + adherence + nagging

## Context & scope

Slice A of the CareFlow-aligned reminder remodel. Replaces the flat Slice-2 medication
model with a generic **care-reminder** engine (medication/rehab/radiotherapy/custom) and
adds adherence logging + persistent nagging. Backend only. Reuses the live Web Push
delivery (`PushSender`/`WebPushSender`), timezone (`users.timezone` + `reminder-clock`),
and the per-minute Cron `scheduled` handler. Snooze/notification-actions, the Today
checklist, the management UI, and low-stock notifications are later slices.

## Architecture

In the existing `src/contexts/notifications/` context:

```
domain/
  care-item.ts         # CareItem entity + CareItemRepository port
  care-schedule.ts     # CareSchedule entity (part of CareItem) + repo methods
  care-log.ts          # CareLog entity + CareLogRepository port
  care-occurrence.ts   # CareOccurrence (nag state) + CareOccurrenceRepository port
application/
  care-items.ts        # CRUD use cases (item + its schedules, inline)
  answer-care-slot.ts  # record done/skipped (+ medication stock decrement)
  run-care-tick.ts     # the cron body: materialize + nag-dispatch + markMissed
adapters/
  drizzle-care-*.ts
```

`reminder-clock.ts`, `PushSubscriptionRepository`, `PushSender`, and the `scheduled`
handler wiring (`buildDeps`) are reused. The Slice-2 `reminder-schedule` /
`reminder-occurrence` files, `medication-reminders.ts`, `run-reminder-tick.ts`, their
routes, tables, and tests are **removed**.

## Key decisions

- **D1 — Generic core, medication as the only structured subtype.** One `care_item` with a
  `category` tag; `dose`/`stock`/`stock_alert` are nullable columns used only when
  `category = medication`. Rehab/radiotherapy/custom use `note` (free-text instructions).
  New categories need no schema change. Validation rejects `stock`/`stock_alert`/`dose` as
  meaningless for non-medication only if we want to be strict — this slice **accepts them
  as nullable and simply ignores dose/stock for non-medication** (no cross-field rejection),
  keeping it simple.

- **D2 — One schedule per time-of-day; PATCH preserves schedule ids (and thus history).**
  A `care_item` has 0..N `care_schedule`s, each a single `time_of_day`, managed **inline in
  the item body**. A PATCH that includes `schedules` **upserts by schedule id** (update
  existing rows in place, insert new ones without an id, delete only the ones the array
  omits) — it does NOT delete-and-reinsert, so `care_log`/`care_occurrence` rows (FK
  `care_schedule_id`) survive an item edit and adherence history isn't cascaded away. A
  PATCH that **omits** `schedules` leaves the schedules unchanged (only patches item fields).
  The full-array replace is last-write-wins (fine for single-user).

- **D3 — `repeat_days` empty = every day; 0=Sun..6=Sat.** Keeps the weekday indexing the
  frontend already uses (Slice 2b), and adds the CareFlow "empty = every day" convenience.
  Active-day test reuses Slice-2 semantics (weekday ∈ repeat_days OR repeat_days empty) AND
  `weeksSince(start_date) % week_interval == 0` AND `start_date ≤ localDate ≤ end_date`.

- **D4 — Nag via `care_occurrence.last_notified_at` + `care_log` as the stop signal.** Each
  tick, per active schedule, compute the user's local date/weekday/minute. A slot **fires**
  (materialize + first push) when `now`'s local minute is within `[slotMinute,
  slotMinute + LOOKBACK]` **on today's local date only** (a small look-back for a skipped
  tick; NOT across midnight — see D7). Upsert `care_occurrence` keyed by (schedule, local_date,
  time_of_day). Then push if **no `care_log` exists** for the slot AND either it's the first
  fire (`last_notified_at` null) OR **`nag_interval_minutes > 0` AND `now − last_notified_at
  ≥ nag_interval_minutes`**; set `last_notified_at = now`. **`nag_interval_minutes = 0` ⇒
  fires exactly once** (the re-nag branch is gated on `> 0`, so the "elapsed ≥ 0 always true"
  trap is avoided). Re-nags continue only while the slot is on today's local date. A
  `care_log` (done/skipped/missed) stops all further pushes. Exactly-once-per-nag-window relies
  on Cron non-concurrency (Slice-2 D6).

- **D5 — Slot key = `(schedule_id, local_date, time_of_day)`, NO local→UTC inversion.**
  `reminder-clock` only converts UTC→local; deriving a UTC instant for the slot (and a
  DST-correct one) is unnecessary. `care_occurrence` and `care_log` store `local_date`
  (`YYYY-MM-DD` date) + `time_of_day` (`HH:mm`) and are unique on `(care_schedule_id,
  local_date, time_of_day)`. The answer endpoint references a slot by
  `{ care_schedule_id, local_date, time_of_day }`. Everything (dedupe, markMissed's
  past-day test) is string/date comparison — DST-proof for any tz.

- **D6 — Answer + stock; decrement only on the transition INTO done.** `POST /api/care/log`
  upserts a `care_log` on `(schedule, local_date, time_of_day)`. Stock is decremented **only
  when this write is the FIRST `done` for the slot** (prior log absent or non-`done`) — so a
  re-POSTed `done` does NOT double-decrement. This slice does **not** support changing a
  slot's status after the fact (a second answer with a different status is a no-op returning
  the existing log — no re-credit/re-decrement); status transitions are out of scope. `done`
  on a `medication` item with non-null `stock` reduces `stock` by `dose_quantity`, clamped
  ≥ 0; `skipped` changes no stock. Answering stops the nag. (Snooze = Slice B.)

- **D7 — markMissed = strictly-past local day, insert-if-absent (no cross-midnight nag).**
  The look-back (D4) is **today-local only**, so a slot is never delivered on a later day.
  markMissed marks any `care_occurrence` whose `local_date` is **strictly before** today's
  local date and which has no `care_log`, by inserting a `missed` log with
  **`onConflictDoNothing`** on the slot key — so a concurrent HTTP `done`/`skipped` landing
  first is not clobbered into `missed` (Cron non-concurrency does not cover the HTTP answer
  path). A slot missed just before midnight becomes `missed` the next day rather than being
  re-delivered across midnight — accepted (matches CareFlow's same-day nag + next-day missed).
  No re-notify for missed.

- **D8 — Per-occurrence dispatch isolation.** One slot's DB/send failure is caught so it
  doesn't abort the whole tick (Slice-2 hardening), best-effort continuing to the next.

- **D9 — Transition: remove the flat model.** `reminder_schedule`/`reminder_occurrence` +
  `/api/reminders/medication` are dropped (the migration drops the tables). The Slice-2b
  medication UI (frontend) will 404 against the removed endpoints until the generic
  management UI ships in the next frontend slice — called out in the PR. Backend stays
  green. (A thin compat shim was considered and rejected: it would double the schedule model
  and cron paths for a UI that's being replaced anyway.)

## Testing

- **`run-care-tick.ts` (unit, fake repos + fake PushSender + fixed now)**: due slot →
  occurrence + push; every-day (empty repeat_days); weekday/week-interval/date-range gating;
  dedupe/double-tick; **nag** re-notify after `nag_interval` and NOT before; `nag_interval=0`
  fires once; a `care_log` stops nagging; midnight look-back keyed to the prior day; markMissed
  writes `missed` for a past unanswered slot; per-occurrence isolation; per-user tz.
- **`answer-care-slot.ts` (unit)**: done writes a log; medication done decrements stock by
  `dose_quantity` clamped ≥ 0; non-medication done touches no stock; skipped logs without
  stock change; idempotent re-answer.
- **Routes (workers project)**: care-item CRUD (create with schedules → get round-trip;
  400 on bad `time_of_day`/`repeat_days`/`week_interval`/dates/category; owner-scoped
  update/delete; 401 unauth); `POST /api/care/log` (200 + effect; 400 on bad status).
- **Not unit-tested (Cloudflare-only)**: the actual Cron firing + real push (on-device).
