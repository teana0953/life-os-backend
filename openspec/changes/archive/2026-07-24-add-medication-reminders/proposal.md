## Why

Second slice of the reminders feature and the first *real* reminder type. Slice 1
proved Web Push delivery end-to-end; this slice builds the **scheduling core** every
reminder type will reuse: a schedule model, a due-instance (`reminder_occurrence`)
table, and a **Cloudflare Cron Trigger** that每分鐘 scans for due occurrences and
sends them via the existing `WebPushSender`. It ships one schedule kind —
**medication** — with day-of-week and every-N-weeks recurrence. Rehab (Slice 3)
reuses the same table with a different category; glucose/missed-meal (Slices 4–5)
reuse the occurrence table + Cron dispatch.

## What Changes

- **`users.timezone`** (new column, default `'Asia/Taipei'`) + `PUT /api/user/timezone`
  (validates an IANA tz). All local-time reasoning uses `Intl.DateTimeFormat` with the
  user's tz — no manual local↔UTC math.
- **`reminder_schedule`** table (medication now; rehab reuses): `user_id`, `category`
  (`'medication'`), `label`, `times` (`text[]` of `"HH:mm"`), `days_of_week`
  (`int[]`, 0=Sun…6=Sat), `week_interval` (default 1), `anchor_date`, `enabled`
  (default true).
- **`reminder_occurrence`** table: `user_id`, `kind` (`'medication'`), `due_at`,
  `title`, `body`, `status` (`pending|sent|skipped`), `dedupe_key` (unique),
  `sent_at`. `dedupe_key` guarantees one occurrence per schedule/day/time.
- **Domain** (in the existing `notifications` context, which already owns
  `push_subscription` + `PushSender`): `ReminderSchedule` + `ReminderScheduleRepository`
  (`create`/`listByUser`/`get`/`update`/`delete` + `listActiveAll` for the cron);
  `ReminderOccurrence` + `ReminderOccurrenceRepository` (`upsertByDedupeKey` — insert
  only if absent, `listDuePending`, `markSent`/`markSkipped`).
- **Use cases**: medication-reminder CRUD (validating `times`, `days_of_week`,
  `week_interval`, `anchor_date`); and **`runReminderTick(now, deps)`** — for each
  active schedule, resolve the user's local date/weekday/`HH:mm` (Intl), decide if
  today is an active day (`days_of_week` contains today AND
  `floor(weeksSince(anchor)) % week_interval === 0`, future anchor skipped), and for
  each `times` entry matching the current local minute (with a small look-back for a
  missed tick) upsert an occurrence; then dispatch: `listDuePending(now)` → send to
  each of the user's `push_subscription`s via `PushSender` → `markSent` (or `markSkipped`
  when the user has no subscription); a `PushSender` `expired` (404/410) result deletes
  that subscription.
- **Cron**: `wrangler.toml` gains `[triggers] crons = ["* * * * *"]`; `index.ts` gains
  a `scheduled` handler composing the same DB/repos/`WebPushSender` as `fetch` and
  calling `ctx.waitUntil(runReminderTick(new Date(), deps))`.
- **API** (authenticated, snake_case): `POST/GET/PATCH/DELETE /api/reminders/medication`.

Backend only, medication only — no rehab/glucose/missed-meal (later slices), no
frontend (a later slice adds the config UI). The real Cron firing is verified on
Cloudflare after deploy; `runReminderTick` is fully unit-tested with an injected
fixed `now` + fake repos + fake `PushSender`. Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Added Capabilities

- `medication-reminders`: an authenticated lifeos user can schedule medication
  reminders (label, times, days-of-week, every-N-weeks) in their timezone, and a
  per-minute scheduler delivers each due reminder to their subscribed devices as a
  Web Push, exactly once per occurrence.
