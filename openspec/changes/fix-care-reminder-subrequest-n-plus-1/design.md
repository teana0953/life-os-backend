## Context

See proposal.md — Why for the measured failure and its three consequences.

The constraints that shape the approach:

- Every Neon HTTP query is one `fetch`, i.e. one Cloudflare subrequest. The free plan allows
  50 per Worker **invocation**. A Cloudflare Workflows `step.do` body runs in its own
  invocation, so the budget is per step, not per instance and not per day.
- A push send is also a `fetch`, so subscriptions count against the same 50 as the queries.
- `withSubrequestBudget()` / `recordSubrequest()` / `hasSubrequestBudgetForRetry()` already
  exist in `src/shared/db/subrequest-budget.ts` and are already wired into the neon fetch
  wrapper (`retry-fetch.ts`). Nothing new needs building for counting; the store simply is
  never established on this path.
- `run-care-day.ts` is deliberately pure-ish application code over repository ports, unit
  tested with fakes; `care-reminder-loop.ts` is the step loop, tested under a strict step
  double. Neither knows about Workflows or HTTP. That separation is worth keeping.
- `CareLogRepository.listByUserAndDate(userId, localDate)` already exists (the care-today
  endpoint uses it). The occurrence repository has no batch read at all.

## Goals / Non-Goals

**Goals:**

- Reads on the reminder path become O(1) in the schedule count, with a test that goes red if
  the per-schedule reads come back.
- The subrequest budget is established and honoured inside every reminder-day step.
- A slot that fails after claiming leaves a trace in both the data and the log.
- An abandoned claim and an orphaned occurrence each stop being silent.

**Non-Goals:**

- Raising any limit, adding a plan upgrade, or adding retries. The fix is fewer queries, not
  more headroom.
- Changing the nag semantics, the first-fire grace window, or the failed/expired retry floor.
- Changing the write path's shape: no batching of per-slot writes, no change to
  "writes are never retried".
- Any schema migration, endpoint, or client-visible payload change.

## Decisions

### D1 — Two new occurrence batch reads, indexed in memory

Add to `CareOccurrenceRepository`:

- `listByUserAndDate(userId, localDate): Promise<CareOccurrence[]>` — every occurrence the
  user has on that local day.
- `listPastUnloggedForUser(userId, todayLocalDate): Promise<CareOccurrence[]>` — the
  user-scoped form of the existing `listPastUnlogged`, same `LEFT JOIN care_log ... IS NULL`
  shape, filtered on `care_occurrence.user_id` instead of one schedule id.

Callers index the result by the slot key `(careScheduleId, timeOfDay)` and look up in memory
where they previously issued `getBySlot`. Resulting read counts:

| operation | before | after |
| --- | --- | --- |
| `buildSlotSnapshots` | `1 + 2N` | 3 (schedules, occurrences, logs) |
| `dispatchDueRounds` | `1 + 2N + D` (D = dispatching slots, each reading subscriptions) | 4 (schedules, occurrences, logs, subscriptions) |
| `markMissedForUserDay` | `1 + N` | 2 (items, past-unlogged) |

*Alternative rejected:* one SQL join returning schedules + occurrence + log per row. It would
be two fewer queries but would push `isActiveOn`'s schedule-activity rules into SQL, where the
existing shared-kernel implementation and its tests could no longer be the single source of
truth. Three reads is already constant; buying a fourth constant back is not worth splitting
that rule in two.

*Keep, do not delete:* the per-slot `getBySlot` / `listPastUnlogged` methods stay — the HTTP
answer/edit paths use them and they are single-slot by nature there.

### D2 — Per-slot writes stay per-slot

`upsertBySlot`, `claimAttempt`, `recordAttempt`, `registerSent`, and `upsertIfAbsent` remain one
statement per slot. Merging them (e.g. a multi-row insert of missed logs) would save
subrequests but make a partial failure unattributable, and `claimAttempt` in particular is the
atomic per-row guard against a step replay double-sending — it has no batch form that keeps
that meaning. This is the correctness-over-subrequests line the proposal draws; the budget check
in D4 is what keeps it safe instead.

### D3 — The budget scope goes on each step body, inside the loop

`care-reminder-loop.ts` wraps the callback it passes to `step.do` in
`withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, ...)`, via one small local helper used by
every step (`mark-missed`, `plan-day-start-wait`, `plan-next-wake`, `dispatch-due-rounds`,
`spawn-next-care-day`, `final-mark-missed`).

Placed in the loop, not in `CareReminderWorkflow`, for two reasons: the loop is what the strict
step double tests exercise, so the wrapping is covered by tests that already run; and the
workflow class is meant to stay a wiring shim with no policy in it.

The constant `FREE_PLAN_SUBREQUEST_LIMIT = 50` moves from
`src/adapters/http/routes/screen-sections.ts` to `src/shared/db/subrequest-budget.ts`, next to
the mechanism it parameterises — a notifications-context file importing an HTTP route file
would invert the dependency direction the rest of the codebase keeps. `screen-sections.ts`
re-exports it so `health-overview.ts` and `home-summary.ts` need no edit beyond the import
source.

*Alternative rejected:* one budget for the whole instance-day. Wrong by a factor of however many
steps run: the limit is per invocation and each step is one. A single instance-wide scope would
report exhaustion after the first few rounds of a 24-hour day and stop dispatching entirely.

### D4 — A round checks headroom before starting each slot's dispatch

`subrequest-budget.ts` gains `remainingSubrequestBudget(): number | null` (`null` outside a
scope — every existing caller and test therefore behaves exactly as today, unlimited).

`dispatchDueRounds` sorts the active slots by `timeOfDay` ascending and, before dispatching each
one, compares the remaining budget against the worst case for a single slot:
`upsertBySlot + claimAttempt + registerSent + recordAttempt` (4) `+ subscriptions.length` push
sends `+ 1` reserve for the failure-recording write from D5. The subscription count is known
because D1 already read it once for the round. When the remaining budget is smaller, the loop
stops, logs `care-dispatch: deferred N slots, subrequest budget exhausted`, and returns. Nothing
is claimed, so the deferred slots are untouched and still due.

Earliest-first ordering matters because a never-materialized slot dies once it falls outside
`FIRST_FIRE_GRACE_MINUTES`; serving the oldest first spends the budget on the slots closest to
that edge.

The next wake is immediate for the deferred slots: `planNextWake` returns `now` for a
still-in-grace unmaterialized slot and `epoch` for a materialized-but-unattempted one. The
busy-loop backoff in the loop still applies if the state genuinely does not change, so this
cannot become a spin.

*Alternative rejected:* let the round throw when it runs out and rely on the Workflows step
retry. The claim is already taken by then, so a step retry finds the slot leased and does
nothing — it converts a budget overrun into exactly the silent drop this change exists to
remove.

### D5 — Failure surfacing: record on the occurrence and log; do not fail the step

In `dispatchSlot`, everything after a won `claimAttempt` runs inside a `try`. On a throw:
best-effort `recordAttempt({ outcome: "failed", detail: <truncated error chain> })`, then
rethrow to `dispatchDueRounds`'s existing per-schedule `catch`, which now logs
`describeErrorChain(err)` with the schedule id instead of swallowing silently. Isolation is
unchanged — the loop continues with the next slot.

The recorded `failed` outcome moves the occurrence out of the abandoned-claim state and onto the
ordinary failed-round floor, which is the correct cadence for a round that actually ran and
failed. If the recording write itself fails (the likely case when the cause was budget
exhaustion), the occurrence stays an abandoned claim and D6's short floor picks it up — the two
mechanisms deliberately cover each other.

*Alternative rejected:* rethrow out of the `dispatch-due-rounds` step so Workflows marks the
step failed. Workflows would retry the step (finding every claim fresh and doing nothing) and,
after its retries, fail the instance — killing the rest of the user's day over one slot. Making
the failure *visible* is the goal; making it *fatal* is not.

### D6 — `ABANDONED_CLAIM_RETRY_MINUTES = 2`

`nextDueAt` gains a branch ahead of the failed/expired case: `lastAttemptAt !== null &&
lastSendOutcome === null` → `lastAttemptAt + 2 minutes`. Because `dispatchSlot` derives the
claim lease from the same `due` it just computed, this automatically becomes the re-claim lease
too, preserving the existing "the lease is exactly as permissive as the due-check" invariant
without a second constant.

Why 2 and not 1 or 10: the lease is the only thing preventing a round still in flight from
being re-claimed and double-sending. A Workers invocation has a hard CPU ceiling far below two
minutes of wall clock, so a round still alive after two minutes is already lost. One minute
narrows that margin for no user-visible benefit; ten minutes is the number that produced the
measured ten-minute-late 16:15 medication reminder.

*Alternative rejected:* clear `last_attempt_at` back to `NULL` on detecting an abandoned claim.
That erases the evidence that an attempt ever ran, which is the same class of silent data loss
this change is fixing.

### D7 — Orphan retirement, keyed off the day's occurrence batch

D1's `listByUserAndDate` returns *every* occurrence for the day, including ones whose
`timeOfDay` no longer matches any of the schedule's active slots for that day. After
`dispatchDueRounds` has built its index, any occurrence in the batch with no matching active
slot and `lastNotifiedAt === null` is retired: `careLogRepo.upsertIfAbsent({ status: "missed",
... })` for its own `(careScheduleId, localDate, timeOfDay)`. `upsertIfAbsent` is insert-if-absent,
so a `done`/`skipped` the user already recorded is never clobbered.

`lastNotifiedAt !== null` orphans are left alone: the user got that push and may still answer
it; the ordinary end-of-day `markMissedForUserDay` already covers them.

Orphans are never dispatched. The user moved the time on purpose, and firing at the old time
would be worse than not firing.

This costs one write per orphan, which is bounded by "how many times the user edited a schedule's
time today" — realistically zero or one, and it is subject to the same D4 headroom check.

*Alternative rejected:* delete the orphaned occurrence row. It would leave no record that a slot
existed at that time, and the care-range endpoint's history would silently change shape after an
edit.

### D8 — Test strategy: the decoupling test must be mutation-provable

The central risk with "it is now O(1)" is a guard that cannot fail. The counting tests therefore
assert two things at once, in the same test:

1. the read count at N = 25 **equals** the read count at N = 1 (the decoupling), and
2. that count **equals a literal** (3 for `buildSlotSnapshots`, 4 for a `dispatchDueRounds`
   round with nothing due, 2 for `markMissedForUserDay`).

Half (1) alone survives a mutation that makes both counts equally wrong; half (2) alone survives
a mutation that changes the constant but keeps it constant. Together they do not.

The counting fake counts *repository method calls*, not subrequests — the fakes never touch
`retry-fetch.ts`. The link from "one repository read" to "one subrequest" is asserted separately
by the PGlite DB-level tests, which exercise the real drizzle methods and prove each new batch
method is a single statement returning exactly what the per-slot reads returned (including the
negative cases: another user, another day, an already-logged slot).

Mandatory mutation check before the change is called done: revert each batched read to its
per-schedule loop, one at a time, and confirm the corresponding counting test goes red — and
that the *specific* assertion intended to catch it is the one that fails, not an unrelated one.

### D9 — Nothing changes on the HTTP paths

`answer-care-slot`, `edit-care-slot`, `get-care-today`, `get-care-range`, `restart-care-day` and
`subscribe-web-push` keep their current queries and their current (unscoped, therefore
unlimited) retry behaviour. They are single-slot or already-batched and are not on the failing
path; touching them would widen the diff without evidence.

## Risks / Trade-offs

- **A round can still be over budget if a single slot's dispatch is itself huge** (a user with
  many push subscriptions) → the headroom check counts `subscriptions.length` explicitly, so
  such a slot is either affordable or deferred; it is never started and abandoned mid-way.
- **Deferral can push a never-materialized slot past its first-fire grace window**, killing it
  for the day → earliest-first ordering makes the at-risk slots the ones that get served, and the
  deferral is logged so the case is diagnosable rather than silent. Accepted: this is strictly
  better than the current behaviour, where the same slot is claimed and then lost with no trace.
- **A two-minute lease shortens the window protecting an in-flight round from a duplicate
  send** → bounded by the Workers invocation CPU ceiling, which is far under two minutes; a
  duplicated reminder is also a much smaller harm than a ten-minute-late medication reminder,
  which is the harm actually measured.
- **Retiring an orphan writes `missed` for a slot the user may not think of as missed** →
  restricted to never-delivered orphans and written insert-if-absent, so it can only ever fill in
  a slot that has no answer at all.
- **The counting tests are the whole guarantee, and counting tests are exactly the kind that
  quietly stop failing** → D8's two-part assertion plus the mandatory revert-and-confirm-red
  mutation step is the mitigation; skipping the mutation step invalidates the change.
- **`FREE_PLAN_SUBREQUEST_LIMIT` is a plan-dependent constant hard-coded in the source** →
  unchanged from today's situation, and re-exported rather than duplicated so there is still
  exactly one definition.

## Migration Plan

No schema change and no data backfill. Deploy is a plain `wrangler deploy`.

In-flight Workflows instances are pinned to the Worker version they were created under, so
already-running instance-days keep executing the old code until their local day ends; the new
code takes effect for instances created after deploy. Nothing in this change alters a step name
or a cached step value's contract, so no in-flight instance can be broken by the deploy.

Rollback is a redeploy of the previous version. Occurrences written by the new code carry no new
columns or states — a `failed` outcome and a `missed` log are both shapes the old code already
produces and reads — so a rollback needs no data repair.
