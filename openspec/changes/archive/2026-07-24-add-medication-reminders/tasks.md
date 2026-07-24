# Tasks

## 1. Schema + migration
- [ ] `shared/db/schema.ts`: `users.timezone` text notNull default `'Asia/Taipei'`;
      `reminder_schedule` (id uuid pk, user_id → users, category text, label text,
      times text[] notNull, days_of_week integer[] notNull, week_interval integer
      notNull default 1, anchor_date date notNull, enabled boolean notNull default
      true, created_at timestamptz default now); `reminder_occurrence` (id uuid pk,
      user_id → users, kind text, due_at timestamptz notNull, title text notNull,
      body text notNull default '', status text notNull default 'pending' (allowed:
      `pending`|`sent`|`skipped`|`failed`), dedupe_key text notNull **unique**,
      created_at timestamptz default now, sent_at timestamptz). Generate the drizzle migration.

## 1b. User timezone (entity + repo)
- [ ] Add `timezone` to the `User` entity (default `Asia/Taipei`) so `getOrCreate` reads
      carry it; add `UserRepository.updateTimezone(userId, tz)`. Update
      `DrizzleUserRepository` + the in-memory fake used in tests.

## 2. Domain: tz clock helpers (TDD, pure)
- [ ] `domain/reminder-clock.ts`: `localParts(now: Date, tz: string) → { date: 'YYYY-MM-DD',
      hhmm: 'HH:mm', weekday: 0..6 }` via `Intl.DateTimeFormat`; `weeksSince(anchorDate:
      string, localDate: string) → number` (whole weeks, ≥0; negative when anchor is in
      the future). Unit-test both (Asia/Taipei + one other zone; week boundaries; future anchor).

## 3. Domain: ports + entities
- [ ] `domain/reminder-schedule.ts`: `ReminderSchedule` { id, userId, category, label,
      times, daysOfWeek, weekInterval, anchorDate, enabled } + `ReminderScheduleRepository`
      (`create`, `listByUser`, `get`, `update`, `delete`, and **`listActiveAll()` →
      `{ schedule, timezone }[]`** joining each enabled schedule with its owner's tz, so
      the tick needs no per-schedule user lookup — D6b).
- [ ] `domain/reminder-occurrence.ts`: `ReminderOccurrence` { id, userId, kind, dueAt,
      title, body, status, dedupeKey } + `ReminderOccurrenceRepository`
      (`upsertByDedupeKey` → inserts only if absent, `listDuePending(now)`, `markSent(id)`,
      `markSkipped(id)`, **`markFailed(id)`**).

## 4. Use case: medication CRUD (TDD, in-memory repo)
- [ ] Tests: create validates each `times` is `HH:mm`, each `days_of_week` in 0..6,
      `week_interval` ≥ 1, `anchor_date` a real date → else `BadRequestError`; list returns
      only the caller's; update (incl. `enabled`) and delete are scoped to the owner.
- [ ] `application/medication-reminders.ts` implementing them.

## 5. Use case: runReminderTick (TDD, fake repos + fake PushSender + fixed now)
- [ ] Tests (see design "Testing"): current-minute match → one occurrence + dispatched;
      double tick → no double-send (dedupe); inactive weekday / off week-interval / future
      anchor / disabled → nothing; **look-back across midnight** — a 23:5x time missed and
      recovered by a 00:0x tick fires once and its dedupe_key uses the PREVIOUS local date;
      no subscription → `skipped`; **all sends fail → `failed` (not `sent`)**; ≥1 send ok
      → `sent`; `expired` send deletes the subscription; per-user timezone respected.
- [ ] `application/run-reminder-tick.ts` implementing materialize-then-dispatch, reusing
      the `PushSubscriptionRepository` + `PushSender` from the notifications context. Uses
      `listActiveAll()`'s joined timezone (no per-schedule user lookup). Look-back on
      absolute local minutes (D3); terminal status per D5 (sent/skipped/failed).

## 6. Adapters (Drizzle)
- [ ] `adapters/drizzle-reminder-schedule-repository.ts` and
      `adapters/drizzle-reminder-occurrence-repository.ts` implementing the ports
      (`upsertByDedupeKey` via `onConflictDoNothing` on `dedupe_key`). Follow the existing
      `Drizzle*Repository` pattern (injected `getDb`).

## 7. Routes + wiring (TDD, integration via createApp)
- [ ] `routes/reminders.ts`: `POST/GET/PATCH/DELETE /api/reminders/medication`
      (`resolveUserId`, snake_case body, `BadRequestError` validation). Route test:
      401 unauth; create→list round-trip; 400 on bad input; update/delete owner-scoped.
- [ ] `routes/user-timezone.ts` (or extend `me`): `PUT /api/user/timezone { timezone }`
      → validate IANA via try/catch `Intl.DateTimeFormat`; 400 on invalid; persist via
      `UserRepository.updateTimezone(resolveUserId(...), tz)`. Route test.
- [ ] `app.ts`: add the new repositories to `CreateAppOptions` + register routes under
      `authMiddleware`.

## 8. Cron + scheduled handler
- [ ] `wrangler.toml`: `[triggers]\ncrons = ["* * * * *"]`.
- [ ] `index.ts`: factor the DB/repository/`WebPushSender` wiring shared by `fetch`, then
      add `scheduled(event, env, ctx)` that builds it and calls
      `ctx.waitUntil(runReminderTick(new Date(), deps))`. Ensure `fetch` and `scheduled`
      share one wiring path (no drift). Add the new repos to the `Env`-driven composition.

## 9. Gate
- [ ] `npm test` + `npm run typecheck` green.
