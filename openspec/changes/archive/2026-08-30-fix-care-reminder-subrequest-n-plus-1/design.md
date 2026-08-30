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

### D4 — A round checks headroom before starting each slot, and again before each send inside it

`subrequest-budget.ts` gains `remainingSubrequestBudget(): number | null` (`null` outside a
scope — every existing caller and test therefore behaves exactly as today, unlimited).
`run-care-day.ts` receives it as a required field on `RunCareDayDeps`
(`remainingSubrequestBudget: () => number | null`) rather than importing
`shared/db/subrequest-budget` directly — the dependency rule keeps `application/` out of
`shared/`, and `test/architecture/dependency-rule.test.ts` enforces exactly that boundary. The
counting store is established by the adapter that owns the invocation
(`care-reminder-loop`'s per-step scope via `budgetedStep`), not by this layer, so a port is the
right shape here regardless of the test.

**This decision has been revised once already** (see the superseded "uncapped, per-subscription
reserve" version of this section, and the rejected `MAX_RESERVED_SUBSCRIPTIONS` cap before it).
Both of those versions gated the *whole slot* on a single all-or-nothing estimate computed before
the claim — the uncapped one scaled that estimate by `subscriptions.length`, which is what
produced a real, confirmed regression: a user with `subscriptions.length >= 21` (roughly `(50 - 4
round-setup reads - 1 failure reserve) / 2`) had every reminder for every schedule silently stop,
on every wake, forever — the exact failure class this change exists to remove, just reached from
the conservative side instead of the cheap side. It does not self-heal, because pruning a stale
subscription (`subscriptionRepo.deleteByEndpoint` on an `expired` send) only happens on an actual
send, and a permanently deferred slot never sends. This repo has a documented incident of stale
subscriptions accumulating past that count after a PWA reinstall
(`lifeos-push-silent-failure.md`), so this was reachable, not theoretical. The fix below replaces
the all-or-nothing estimate with two checks at two different points, neither of which scales with
`subscriptions.length`.

**Check 1 — the slot-entry gate, in `dispatchDueRounds`, before the claim.** `dispatchDueRounds`
sorts the active slots by `timeOfDay` ascending and, before dispatching each one, compares the
remaining budget against a FIXED cost: `SLOT_DISPATCH_WRITES` (`upsertBySlot + claimAttempt +
registerSent + recordAttempt`, 4 — `registerSent` is one batch insert covering every subscription
in the round, so it does not scale either) `+ PER_SUBSCRIPTION_WORST_CASE` (2: the cost of one
send's worst case — the send itself, plus `subscriptionRepo.deleteByEndpoint` if that send comes
back `expired`) `+ FAILURE_RECORD_RESERVE` (1, for D5's catch). Total: 7, independent of
subscription count. This is deliberately an underestimate of the slot's true total cost for
`subscriptions.length > 1` — it only has to answer "is it worth claiming this slot at all", not
"can the whole fleet be reached this wake". When the remaining budget is smaller than 7, the
slot-dispatch loop breaks and logs `care-dispatch: deferred N slots, subrequest budget exhausted`.
Nothing is claimed, so the deferred slots are untouched and still due; `dispatchDueRounds` then
still runs `retireOrphanedOccurrences` (D7) for the round, subject to its own budget check.

**Check 2 — the per-send gate, in `sendClaimedSlot`'s dispatch loop, before each individual
send.** Once a slot is claimed, its subscriptions are sent to one at a time; before EACH send the
loop compares the remaining budget against `PER_SUBSCRIPTION_WORST_CASE` (this send's own worst
case, same 2 as above) `+ SLOT_TAIL_RESERVE` (2: the `recordAttempt` write that always follows the
loop, whether it ran to completion or stopped early, plus `FAILURE_RECORD_RESERVE`'s fallback if
that write itself throws). When that does not fit, the loop stops sending to the *remaining*
subscriptions — logging `care-dispatch: stopped mid-slot after K/N sends, subrequest budget
exhausted` — and falls through to the same `summarizeOutcome` / `recordAttempt` call the loop
would reach on a normal finish. `SLOT_TAIL_RESERVE` is never spent by the loop itself, so that
`recordAttempt` is always affordable: **the slot always ends with a recorded outcome**, whether
every subscription was reached or only the first few were. This is the structural change from the
all-or-nothing design: a large fleet on a tight budget is now a *partial delivery with a recorded
result*, never an unclaimed slot and never a slot claimed and then abandoned mid-dispatch.

Two consequences of partial delivery, stated rather than left implicit: (a) a device skipped this
wake is not retried until the slot's next nag cycle (or, for a one-shot slot, not at all this
day) — there is no separate "finish the rest of the fleet" pass; (b) `summarizeOutcome` sees only
the subscriptions actually attempted, so a slot that reached 1 of 25 devices is recorded exactly
the same as one that reached all 25 and had 24 truly fail — `lastSendOutcome: "sent"`, `delivered:
true` — because at least one send succeeded (D10's pre-existing "partial success counts as
delivered" rule, now also covering "partial *attempt*"). `registerSent` still registers a
`push_delivery` row for every subscription in the round up front (one batch insert, so this does
not itself scale the budget), including ones the per-send gate may end up skipping; a
registered-but-unsent row is simply never acked — not a data-integrity issue, just an unused row.

Earliest-first ordering (across slots, in `dispatchDueRounds`) still matters for the same reason
as before: a never-materialized slot dies once it falls outside `FIRST_FIRE_GRACE_MINUTES`;
serving the oldest first spends the entry-gate budget on the slots closest to that edge. It says
nothing about the ORDER subscriptions are sent to within one slot, which is whatever
`subscriptionRepo.listByUser` returns — a partial send has no defined "which devices get skipped"
guarantee beyond that.

The next wake is immediate for a slot the entry gate deferred entirely: `planNextWake` returns
`now` for a still-in-grace unmaterialized slot and `epoch` for a materialized-but-unattempted one.
A slot that partially sent is different — it now has a recorded `sent` outcome, so it is due again
on the ordinary nag cadence (or not at all, for a one-shot slot), same as any other successful
round; there is no separate "resume the skipped devices sooner" wake. The busy-loop backoff in the
loop still applies if the state genuinely does not change, so neither case can become a spin.

*Alternative rejected:* let the round throw when it runs out and rely on the Workflows step
retry. The claim is already taken by then, so a step retry finds the slot leased and does
nothing — it converts a budget overrun into exactly the silent drop this change exists to
remove. This is why check 2 stops the LOOP rather than letting a send or `recordAttempt` throw:
throwing is the platform doing the stopping, unpredictably and after budget is already spent;
checking first is this code doing the stopping, predictably, with room reserved for the write that
records what happened.

*Alternative rejected (superseded, kept for history): scale the entry-gate reserve by
`subscriptions.length`, uncapped.* This was the design from the previous round of this change. It
is safe against overrunning the platform's real subrequest ceiling mid-dispatch (which the
rejected cap below was not), but it gates the *whole slot* on the *whole fleet's* worst case before
even claiming it, which is exactly what produces the `subscriptions.length >= 21` permanent
starvation described above. Checks 1 and 2 above replace it: check 1 no longer needs to reason
about the fleet size at all, and check 2 makes the loop itself — not a single upfront estimate —
responsible for staying inside budget as the fleet is actually walked.

*Alternative rejected: cap how many subscriptions the reserve accounts for* (e.g.
`min(subscriptions.length, 20)`), so a large fleet's estimate stays affordable instead of
deferring forever. This clamps the *estimate* below the true worst case without changing how many
subscriptions `sendClaimedSlot` actually dispatches to, so a fleet past the cap gets a headroom
check that reports "affordable" for a slot whose real dispatch then overruns the platform's
actual subrequest ceiling mid-way. That overrun is not absorbed by D5/D6 the way the Risks section
below assumes for a single huge slot: the failure-recording write in `dispatchSlot`'s catch is
itself one more subrequest against a budget that is, by construction, already exhausted, so it
fails too, leaving the occurrence an abandoned claim. `ABANDONED_CLAIM_RETRY_MINUTES` then retries
it — at the *same* remaining budget, since a fresh Workflows step wake starts from the same fresh
limit — reproducing the identical overrun every two minutes, forever, each time re-sending to
every subscription the round reaches before failing. That is strictly worse than the deferral it
was meant to avoid: a permanent defer sends nothing after the first wake notices it can't afford
the slot; a capped reserve sends duplicates to the same devices every two minutes, indefinitely,
while never recording an outcome. Confirmed by construction: with `MAX_RESERVED_SUBSCRIPTIONS =
20` and 44 real subscriptions, the capped reserve (`4 + 2×20 + 1 = 45`) fits inside a fresh
46-request round, but the real cost of a retry round (`4 round-setup reads + claimAttempt +
registerSent + 44 sends + recordAttempt = 51`) exceeds the 50-request ceiling — five consecutive
simulated wakes each sent 43 more pushes with the occurrence left at `lastSendOutcome: null`
throughout. Neither an uncapped nor a capped single upfront estimate is safe to leave unattended;
check 2's per-send gate is what actually resolves the tension between the two, because it does not
need to guess the fleet's cost in advance at all.

The Context section's "a push send is also a fetch" premise only holds if something actually
records it: `src/index.ts`'s composition root wires `WebPushSender`'s `fetchImpl` to call
`recordSubrequest()` before delegating to the real (bound) global `fetch`. Without this wiring
`remainingSubrequestBudget()` never sees a push send at all and over-reports headroom to every
caller of `hasHeadroomFor` by however many pushes the round has already sent — the exact silent
drop D4 exists to remove, just moved one layer down.

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
slot, `lastNotifiedAt === null`, AND a schedule still present in today's active-slot batch
(`scheduleById.has(occurrence.careScheduleId)`) is retired: `careLogRepo.upsertIfAbsent({
status: "missed", ... })` for its own `(careScheduleId, localDate, timeOfDay)`.
`upsertIfAbsent` is insert-if-absent, so a `done`/`skipped` the user already recorded is never
clobbered.

The `scheduleById.has(...)` restriction is narrower than "any current-day occurrence with no
matching active slot": it retires *same day* only orphans whose schedule is edited (time of day
changed) mid-day while the schedule itself stays active. A schedule disabled or deleted mid-day
has no entry in today's active-slot batch at all — that batch is where this round already knows
the schedule's current `doseQuantity`, which `upsertIfAbsent` requires to write a `missed` log,
and fetching it separately per orphan would reintroduce exactly the per-schedule read D1 removes.
That narrower case is left unresolved by this change: `markMissedForUserDay` builds its owner
lookup from `enabled` schedules only (pre-existing behavior this change does not touch — see its
`enabledSchedules` map), so a disable/delete orphan's occurrence has no owner there either, on
this day or any later one. For a disabled schedule the occurrence sits with no outcome until the
schedule is re-enabled, at which point the next `markMissedForUserDay` run picks it up (its owner
lookup is keyed by `careScheduleId`, not by whether the schedule was enabled when the occurrence
was created). A *deleted* schedule is a different case, not a harder version of this one:
`care_occurrence.care_schedule_id` is `ON DELETE cascade` (`src/shared/db/schema.ts`, applied in
`drizzle/0015_loud_mauler.sql`) and `DrizzleCareItemRepository` hard-deletes both `care_item` and
`care_schedule` rows — there is no soft delete anywhere in this path. Deleting a schedule deletes
its occurrence rows with it, so there is no orphan left to sit unresolved; "never resolved" would
describe a row that no longer exists. This is a pre-existing gap for the disabled case only, not
something this change was scoped to close — see the matching carve-out in
`specs/care-reminders/spec.md`.

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

For `dispatchDueRounds` there is a third, orthogonal gap the two-part assertion above does not
close by itself: the "nothing due" fixture returns from `dispatchSlot` at its very first line
(`candidateMinute > nowMinute`), before `slotState.occurrence`/`slotState.answered` are ever
touched. A per-schedule read reinserted anywhere after that early return is invisible to that
fixture no matter how the count is asserted, because it never runs for that fixture in EITHER
version of the code. A second `dispatchDueRounds` counting test therefore uses a fixture where
every slot IS due (so `dispatchSlot` walks past that guard) but already answered (so it still
costs zero writes and the read count stays the batched constant). Both fixtures are needed: the
"nothing due" one is still the one that matches the literal spec scenario wording, and the
"due-but-answered" one is the one a mutation-check actually exercises.

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

- **A single slot's dispatch can itself be huge** (a user with many push subscriptions) → D4's
  per-send gate inside `sendClaimedSlot`'s loop, not a single upfront estimate, is what keeps this
  safe: the loop stops sending to the *remaining* subscriptions once the budget can no longer
  cover `PER_SUBSCRIPTION_WORST_CASE + SLOT_TAIL_RESERVE`, and `SLOT_TAIL_RESERVE` guarantees the
  slot still ends with a recorded `recordAttempt` outcome. Such a slot is therefore a partial
  delivery with a result recorded — never started-and-abandoned mid-way, and (unlike the
  superseded uncapped-reserve design this replaces) never permanently unclaimed just because the
  fleet is large. The trade-off this accepts instead: the un-reached subscriptions in a large fleet
  wait for the slot's next nag cycle rather than being retried sooner within the same wake.
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
- **`markMissedForUserDay` loses its old per-schedule failure isolation** → the pre-change loop
  wrapped each schedule's own `listPastUnlogged` in try/catch, so one read failure never lost the
  rest of the pass. Batching into `listPastUnloggedForUser` (D1) makes that impossible — there is
  no longer a per-schedule read to isolate around. A failure now propagates out of
  `markMissedForUserDay` to the caller's `step.do("mark-missed", ...)`, which Workflows retries at
  the step level. This is coarser (the whole pass retries, not just the one schedule that failed)
  but not silent, and nothing is lost even across repeated failures: `listPastUnloggedForUser`
  reads every strictly-past unanswered occurrence, not just today's, so the next instance-day's
  own `mark-missed` sweeps up whatever this pass never got to.

## Migration Plan

No schema change and no data backfill. Deploy is a plain `wrangler deploy`.

In-flight Workflows instances are pinned to the Worker version they were created under, so
already-running instance-days keep executing the old code until their local day ends; the new
code takes effect for instances created after deploy. Nothing in this change alters a step name
or a cached step value's contract, so no in-flight instance can be broken by the deploy.

Rollback is a redeploy of the previous version. Occurrences written by the new code carry no new
columns or states — a `failed` outcome and a `missed` log are both shapes the old code already
produces and reads — so a rollback needs no data repair.
