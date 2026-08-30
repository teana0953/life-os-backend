## Why

Care reminders are being dropped in production, silently. Every Neon HTTP query is one
Cloudflare subrequest, and the Workers free plan allows 50 per invocation. The
`CareReminderWorkflow` path issues a number of queries that grows linearly with the user's
schedule count (`1 + 2N` in `buildSlotSnapshots`, `1 + N` in `markMissedForUserDay`, plus one
subscription read per dispatching slot), so a user crossing roughly ten schedules starts
hitting the cap. The measured error is:

```
[db] transient failure not retried (body is not read-only):
Error: Too many subrequests by single Worker invocation. shape=update x1
```

This is not a hypothesis; it was observed on-device, and it presents to the user as
"reminders broke after I added another one".

Three measured consequences make it invisible rather than loud:

- `dispatchSlot` throws *after* winning `claimAttempt`, `dispatchDueRounds`'s per-schedule
  `catch {}` swallows the error with no log, and the `dispatch-due-rounds` Workflows step
  still reports success. The occurrence is left as an abandoned claim (`last_attempt_at` set,
  `last_send_outcome` NULL) that nothing reports.
- An abandoned claim only becomes due again after `max(nag_interval_minutes, 10)` minutes.
  Schedule `073068be`'s 16:15 slot on 2026-08-30 was delivered ten minutes late for exactly
  this reason.
- Editing a schedule's `time_of_day` mid-day (16:05 → 16:15) orphans the already-claimed
  16:05 occurrence: every read is keyed on the schedule's *current* `time_of_day`, so that row
  is never retried, never sent, and stays `last_send_outcome = NULL` until tomorrow's
  `markMissed`.

The retry brake that exists for exactly this cap is also switched off on this path:
`hasSubrequestBudgetForRetry()` reads an `AsyncLocalStorage` store established only by
`withSubrequestBudget()`, and only `health-overview.ts` and `home-summary.ts` establish one.
With no store the brake returns `true` unconditionally, so one transient read failure inside
a workflow step can burn four subrequests instead of one — the amplifier sitting on top of
the N+1.

## What Changes

- **Decouple a reminder round's reads from the schedule count.** `buildSlotSnapshots`,
  `dispatchDueRounds` and `markMissedForUserDay` read the day's occurrences, logs and push
  subscriptions in a fixed number of batch queries and index them in memory, instead of one
  or two queries per schedule. Per-slot *writes* stay per-slot — merging them would trade
  correctness (which slot failed) for subrequests, which this change explicitly refuses.
- **Turn the retry brake on where it matters.** Every `CareReminderWorkflow` step body runs
  inside a `withSubrequestBudget()` scope, so `hasSubrequestBudgetForRetry()` can actually
  say "no". The scope is per *step*, not per instance: each step is its own Worker
  invocation and gets its own 50.
- **Stop dispatching before the cap instead of crashing into it.** When a round's remaining
  budget cannot cover another slot's dispatch, the remaining slots are left unclaimed and
  deferred to the next wake (earliest scheduled slot served first), rather than being claimed
  and lost.
- **Make a failed dispatch visible.** A slot that throws after winning its claim records a
  `failed` attempt with a short diagnostic and is logged with its schedule id; the round no
  longer swallows the error with no trace.
- **Retry an abandoned claim in minutes, not nag-intervals.** An occurrence with an attempt
  time but no recorded outcome gets its own short retry floor, separate from the
  failed/expired floor.
- **Retire an orphaned occurrence the same day.** An occurrence for a slot that is no longer
  among today's active slots and was never delivered is written off as `missed` when
  detected, instead of dangling with a NULL outcome until tomorrow.

No API surface changes; no migrations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `care-reminders`: adds requirements that a reminder day's database reads do not grow with
  the schedule count and stay inside the platform's per-invocation subrequest limit; that a
  dispatch failure after a claim is recorded and logged rather than silently reported as a
  successful round; that an abandoned claim is retried on a short floor; and that an orphaned
  occurrence left by a same-day schedule edit is resolved the same day.

## Impact

- `src/contexts/notifications/application/run-care-day.ts` — batch reads, budget-aware
  dispatch loop, failure recording, abandoned-claim floor, orphan retirement.
- `src/contexts/notifications/domain/care-occurrence.ts` and
  `src/contexts/notifications/adapters/drizzle-care-occurrence-repository.ts` — two new
  batch read methods.
- `src/contexts/notifications/adapters/care-reminder-loop.ts` — per-step subrequest budget
  scope.
- `src/shared/db/subrequest-budget.ts` — the free-plan limit constant moves here from
  `src/adapters/http/routes/screen-sections.ts` (a notifications-context file must not import
  an HTTP route), plus a remaining-headroom accessor.
- Existing behaviour deliberately untouched: writes are never retried
  (`src/shared/db/retry-fetch.ts`), and the nag/first-fire gates keep their current numbers.
