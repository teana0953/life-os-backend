## Why

Generalize the reminder engine into a **care-reminder** system modeled on the user's
own CareFlow app: one engine covering medication, rehab, post-radiotherapy care, and
custom tasks — where **only medication** carries dose + stock, and everything else uses a
free-text instruction note. It also adds the two things the flat Slice-2 model lacked and
that make CareFlow's UX: an **adherence log** (done / skipped / missed) and **persistent
nagging** (re-notify until the slot is answered). It stays on the live Web Push + Cron
foundation. This **replaces** the Slice-2 flat medication model.

## What Changes

- **New generic model** (in the `notifications` context), replacing `reminder_schedule` /
  `reminder_occurrence`:
  - `care_item`: `category` (`medication`|`rehab`|`radiotherapy_care`|`custom`), `title`,
    `note` (instructions — the free-text field that lets rehab/radiotherapy work), and —
    **medication only** — `dose`, `stock`, `stock_alert` (all nullable).
  - `care_schedule` (one per time-of-day; a `care_item` has 0..N): `time_of_day` (`HH:mm`),
    `repeat_days` (`int[]`, 0=Sun..6=Sat, **empty = every day**), `week_interval`,
    `start_date`, `end_date` (nullable), `dose_quantity`, `nag_interval_minutes`
    (0 = fire once), `enabled`.
  - `care_log` (adherence): `care_schedule_id`, `scheduled_time`, `status`
    (`done`|`skipped`|`missed`), `done_time`, `dose_quantity`; unique per (schedule, slot).
  - `care_occurrence` (nag state): (schedule, `scheduled_time`) → `last_notified_at`;
    unique per (schedule, slot).
- **Cron dispatch (per-minute `scheduled` handler, reusing `reminder-clock` tz + the
  midnight-safe absolute-minute look-back)**: materialize a `care_occurrence` for each due
  slot; **nag** — if the slot has no `care_log`, and it's the first fire or
  `now − last_notified_at ≥ nag_interval_minutes`, and still within the local day, send the
  Web Push (title = item title, body = note/dose summary) to the user's subscriptions and
  update `last_notified_at` (prune expired 404/410 subscriptions); a `care_log` stops the
  nag; `nag_interval_minutes = 0` fires exactly once. **markMissed** — on local day
  rollover, slots with an occurrence but no log get a `missed` log. Each occurrence's
  dispatch is isolated (one failure doesn't abort the tick — Slice-2 hardening).
- **Endpoints** (authenticated, snake_case): `POST/GET/PATCH/DELETE /api/care/items`
  (schedules managed inline in the item body); **`POST /api/care/log`**
  `{ care_schedule_id, scheduled_time, status: done|skipped }` → idempotent-upsert the log;
  a `done` on a medication item with a `stock` decrements it by `dose_quantity` (clamped ≥ 0).
- **Removes** `reminder_schedule` / `reminder_occurrence` + `/api/reminders/medication`
  (the Slice-2b medication UI is superseded by the generic management UI in the next
  frontend slice; noted in the PR).

Backend only — done/skipped/missed logging + nagging + stock decrement. **No** snooze /
notification actions (later slice), **no** Today checklist / management UI (frontend
slices), **no** low-stock *notification* (this slice only decrements), no glucose/BP.
Real Cron firing is verified on Cloudflare; the tick logic is fully unit-tested with an
injected `now` + fakes. Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Added Capabilities

- `care-reminders`: an authenticated user can schedule generic care reminders (medication,
  rehab, radiotherapy care, or custom — with title, instructions, times, weekdays,
  every-N-weeks, date range, and a nag interval), have a per-minute scheduler deliver and
  re-nag each due slot until it's answered, and record done/skipped adherence (with
  medication stock decremented on done).

### Removed Capabilities

- `medication-reminders`: the flat Slice-2 medication model (`reminder_schedule` +
  `/api/reminders/medication`) is replaced by the generic `care-reminders` model above
  (medication becomes the `medication` category with dose/stock).
