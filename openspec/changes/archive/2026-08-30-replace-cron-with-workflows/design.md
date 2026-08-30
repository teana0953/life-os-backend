# Design — Replace the per-minute Cron dispatch tick with Cloudflare Workflows

## Context & scope

Replaces `run-care-tick.ts` (a per-minute `[triggers]` Cron body) with
`CareReminderWorkflow`: one Cloudflare Workflows instance per (user, local day) that
sleeps until each of that user's reminders is due, dispatches it, and re-plans its next
wake — instead of every user on Earth being scanned every minute. The daily Cron
survives, downgraded from "dispatch everything" to "make sure an instance exists for the
next day this user actually has something scheduled."

*(fix/idle-instance-chain, later revision: the original chain was "one instance per
calendar day, forever". That meant a user who takes a pill only on Mondays still had an
instance created every single day, waking at midnight only to hand off to the next one,
and a user whose schedules had all expired kept an endless chain of instances with
nothing to do. The chain now jumps straight to the next day something actually fires,
and ends when nothing ever will — W1' below.)*

This directly answers two things `add-medication-reminders/design.md` explicitly
deferred or assumed away:

- **D6** rested on "Cloudflare Cron never runs two invocations of the same trigger
  concurrently." Workflows steps are **at-least-once with replay** — that premise is
  gone, and this change adds back an atomic dispatch claim.
- **D1**'s "detect the current minute" model gave every reminder an implicit ≤1-minute
  latency, for free, because *something* was always running that minute. A
  sleep-until-due model has to earn that back on purpose (D1' below), and has to
  decide, on purpose, what to do about latecomers (D3/D11/D12 revisions below).

## Architecture

```
src/contexts/notifications/
  domain/
    care-occurrence.ts          # + claimAttempt (leased claim)
    care-day-instance.ts        # NEW: CareDayInstanceManager port
  application/
    run-care-day.ts             # NEW: pure(ish) core — replaces run-care-tick.ts
    ensure-care-day-instances.ts# NEW: the daily cron's body (repair, not dispatch)
    restart-care-day.ts         # NEW: shared "best-effort restart today" helper
    care-items.ts                # + optional restart-on-change hook
    subscribe-web-push.ts        # + optional restart-on-subscribe hook
  adapters/
    drizzle-care-occurrence-repository.ts  # + claimAttempt (conditional UPDATE)
    care-reminder-workflow.ts              # NEW: WorkflowEntrypoint (thin)
    workflows-care-day-instance-manager.ts # NEW: CareDayInstanceManager impl
shared-kernel/reminder-clock.ts # + utcInstantFor, nextLocalMidnightInstant
wrangler.toml                   # crons downgraded to daily; + [[workflows]] binding
```

`domain`/`application` never import `cloudflare:workers` — `care-day-instance.ts`
defines a plain port (`ensureFor`/`restartToday`); only
`workflows-care-day-instance-manager.ts` and `care-reminder-workflow.ts` touch the
actual Workflows binding/types, keeping the dependency rule intact (CLAUDE.md).

**W1 — one instance per (user, local day).** The **chained** path (the Cron's
`ensureFor`, and the workflow's own `spawn-next-care-day`) uses the deterministic id
`care-day_{userId}_{localDate}` and is found by construction — neither ever touches the
pointer table below. The **restart** path (`restartToday` — see below) creates under a
fresh `care-day_{userId}_{localDate}_r{randomUUID}` id instead (Cloudflare rejects
`create()` for any id used before, even a just-terminated one, so the deterministic id
can only ever be created once per day). Restart's id therefore isn't derivable from
`(userId, localDate)` — `fix/restart-instance-tracking`'s `care_day_instance_pointer`
table (one row per user: `local_date`, `instance_id`) is what makes it findable again:
`restartToday` reads it, creates a fresh instance FIRST, only then compare-and-swaps the
pointer to that freshly created id (`DrizzleCareDayInstancePointerStore.setCurrentIfMatch`,
a single `INSERT ... ON CONFLICT ... setWhere` — atomic in Postgres, not a read-then-write
from application code), and only then terminates whatever the pointer named before. This
restores the "one instance per (user, local day)" invariant as the steady state for
every completed `restartToday` call — subject to residual risk (d) below, an interrupted
call's own cleanup step failing to run at all —
including across any number of consecutive restarts and across two `restartToday` calls
landing at once — both when both calls read the identical pointer state (the CAS lets
only one caller treat itself as "current"; the other terminates the instance it already
created for itself rather than leaving it untracked) and when the calls are sequential
rather than simultaneous, a second call reading and winning against the pointer value the
first call's CAS just committed. The create-before-CAS ordering is what makes the
sequential case sound: **the pointer can never name an id that has not been created yet**,
so a call that reads a non-null pointer value is always reading something real, and
terminating it is always terminating something real — never a no-op that lets a
soon-to-exist duplicate survive unmatched.

*(An earlier revision of this design accepted "a restarted-away instance can't be found
and terminated by a later restart; multiple instances may run concurrently for a
while" as a permanent tradeoff. Production evidence on 2026-08-12 — two `_r`-suffixed
instances alive simultaneously for one user after two saves 35 seconds apart — showed
that tradeoff firing on every one of `restartToday`'s three call sites, not as a rare
edge case. A first attempt at `fix/restart-instance-tracking` wrote the pointer BEFORE
`create()` and added a post-create "reconciliation" re-check to catch a later call
superseding it in between — that attempt was proven unsound in review (a probe test
forcing a further interleaving — the superseding call's own `terminate()` landing on an
id that had not been created yet, followed by its CAS winning before the original call's
own reconciliation check ran — still produced two live instances). **This design instead
reorders create-before-CAS**, which removes the class of bug structurally rather than
adding another check on top of the ordering that produced it.)*

**W1' — the chain lands only on days that actually have something scheduled
(fix/idle-instance-chain).** One domain function decides which day comes next:

```ts
// contexts/notifications/domain/care-schedule.ts
nextCareChainDate(schedules, afterLocalDate): string | null
```

It scans forward day by day from `afterLocalDate + 1` (never `afterLocalDate` itself),
returning the first day some **enabled** schedule is `isActiveOn`. All three places that
ever ask "which day should own an instance" call it — the running instance's own exit,
the restart gate, and the daily cron — so they cannot disagree. `isActiveOn` is
untouched; the `enabled` filter lives in this function (not in SQL, not in `isActiveOn`)
so that the whole rule has exactly one place a mutation test can attack.

- **Scan horizon: `CARE_CHAIN_HORIZON_DAYS = 90`.** Reaching the horizon with no hit is
  not "give up": if some enabled schedule could still fire beyond it (no end date, or an
  end date past the horizon), a **checkpoint** day inside the scanned window is returned
  — an instance sleeps to it, finds nothing, re-scans from there, and either jumps
  another horizon or terminates. This is what supports an arbitrarily long `weekInterval`
  without an unbounded scan, and it is why the chain no longer depends on when the cron
  happens to run. 90 is **deliberately far below** every platform ceiling rather than
  derived from one: a single `step.sleep` may span up to a year, but this feature has
  now failed in production three times because the real API refused what the docs and
  types allowed (an instance id containing `:`, a `sleepUntil` for a past instant,
  reusing a terminated id), so no correctness argument here is allowed to rest on being
  inside a limit by a computed margin. The cost of 90 over 365 is ~4 checkpoint wakes a
  year instead of 1, at 8 steps each (counted, not estimated: mark-missed 1 +
  plan-day-start-wait 2 + sleep-until-day-start 1 + plan-next-wake 2 +
  sleep-until-next-due 1 + spawn-next-care-day 1) — ~32 steps a year against the
  1,024-per-instance ceiling, so the choice of 90 costs nothing that matters.
- **The checkpoint sits on a fixed calendar grid, NOT at `anchor + horizon`.** It is the
  first day in the scanned window with `epochDayOf(day) % CARE_CHAIN_HORIZON_DAYS === 0`;
  since any 90 consecutive days contain exactly one such day, the scan can never fail to
  find one (which is why the horizon and the grid modulus are the same constant and must
  stay so). This is load-bearing, not tidiness. The cron re-anchors on a *different day
  every day* (`previousLocalDate(today)`), so with an anchor-relative checkpoint a
  dormant user would be handed a different target date on every daily run → a different
  deterministic instance id → `ensureFor` never collides → one new idle 90-day sleeper
  accumulating per user per day, ~90 of them in steady state against the free plan's 100
  concurrent instances, each in turn spawning its own successor. That is the runaway idle
  chain this change exists to kill, amplified 90x. It is reachable in ordinary use, not
  in theory: `validateSchedule` caps neither `weekInterval` nor how far ahead `startDate`
  may sit, so any `weekInterval >= 13`, or a course of treatment starting in four months,
  lands in the checkpoint branch permanently. On the grid, every anchor inside one grid
  cell yields the same day, so cron and chain converge on a single id. Guarded by
  `care-schedule.test.ts`'s and `ensure-care-day-instances.test.ts`'s grid cases
  (mutation-verified: restoring `anchor + horizon` turns **five** tests red — four of
  them the `BLOCKER:`-prefixed ones, three in `care-schedule.test.ts` and one in
  `ensure-care-day-instances.test.ts`, plus the un-prefixed `care-schedule.test.ts` case
  "beyond the horizon: an open-ended long-interval schedule returns a grid checkpoint
  inside the scanned window"). The count and the `BLOCKER:` set are not the same set.
- **`null` means the chain ends.** No enabled schedule can ever fire again → no
  successor is spawned, and the cron creates nothing for that user either.
- **A future-dated instance must sleep to its own day first.** Because the chain and the
  cron now both create instances for days that have not started yet, `runCareReminderDay`
  begins with a `plan-day-start-wait` step: if the live local date is before the
  instance's own `localDate`, sleep until that day's 00:00 and re-check. Without it a
  future-dated instance would immediately see `today !== localDate`, exit, spawn its own
  successor, and repeat — an unbounded same-instant cascade that burns the step budget.
  For an instance owning today (every instance that existed before this change) the wait
  is 0 and no `sleep` is issued at all, which the strict step double's rejection of a
  non-positive `sleep` is what guards.
- **`mark-missed` still runs first, before that wait.** A successor is created at the
  previous care day's local midnight and starts running immediately, so "yesterday's
  unanswered slots get marked missed at midnight" keeps exactly the timing it had. Only
  a day an instance actually ran ever materializes occurrences, so the days the chain
  jumps over normally have nothing to mark. The exception, stated rather than glossed:
  if the user edits schedules *after* the chain has already jumped past a day and a
  transitional restart instance then materializes occurrences on it, that day's
  `mark-missed` window has already gone by. Those slots are not lost — the next
  instance's `mark-missed`, or `final-mark-missed`, still marks them — they are just
  late, bounded by one firing interval (worst case one checkpoint horizon).
- **A terminating chain marks its own last day.** Every other day's unanswered slots are
  marked by the *next* day's instance; the last one has no next. When the successor is
  `null`, the instance runs one extra `final-mark-missed` step for its own day
  (`upsertIfAbsent`, so a real answer is never clobbered).
- **The successor decision reads the schedule calendar only** — never occurrences or
  logs. "Today's slots are all answered" and "today has no slots" are deliberately
  different things: a fully-answered Monday still spawns the next Monday.
- **New invariant: every future-dated instance is created under the deterministic id.**
  `restartToday`'s `_r`-suffixed ids only ever name *today*. That is what makes two
  chains that briefly coexist converge: the successor function is deterministic over the
  same DB, so any two chains must land on the same next day, collide on that day's
  deterministic id, and the loser's `create` silently fails — merging into one chain.
  Same-day duplicate dispatch is separately prevented by `claimAttempt`.

  The convergence argument needs the grid to be *unconditional*, and this is the second
  reason for it. Where a real firing day exists, two chains anchored on different days
  converge trivially: the later chain's day sequence is a suffix of the earlier one's, so
  they meet at the first firing day at or after the later anchor. In the checkpoint
  branch that reasoning does **not** carry: anchor-relative checkpoints give the two
  chains the sequences `c1, c1+90, c1+180, …` and `c2, c2+90, …`, which for
  `c1 ≢ c2 (mod 90)` are **disjoint forever** — a schedule starting in four years would
  keep both chains alive, unmerged, for four years. On the grid both sequences are the
  same set of grid days, so they collide on the first grid day after the later anchor —
  at most one horizon away, with no premise about firing days at all.

**Residual risks (deliberately accepted, not hidden):**
- **(a) `setCurrentIfMatch` fails, or cannot be verified to have succeeded, after the
  instance was already created.** An unverifiable CAS is always treated as a loss (never
  assumed to have won) — see `restartToday`'s `wonRace` variable — so the call terminates
  the instance it just created, for itself, rather than risk leaving an untracked live
  instance. The cost of guessing wrong (the CAS actually DID land, silently) is that the
  pointer briefly names a now-terminated id: for a short window NO instance is current
  for that user/day. This self-heals at the next `restartToday` (which reads the dead id
  back out, terminates it as a harmless no-op, and creates a fresh one) or within 24h via
  the daily Cron's `ensureFor` repair pass regardless. A temporary coverage gap is the
  deliberately chosen failure mode over a permanent orphan, which would never self-heal
  (nothing ever again derives an orphaned id to look it up).
- **(b) Two `restartToday` calls landing within the same instant, at the exact
  `pointerStore.getCurrent` read, could in principle still both observe the pointer
  mid-write** if Postgres's own MVCC snapshot isolation didn't serialize the two
  `setCurrentIfMatch` statements — it does (a single `INSERT ... ON CONFLICT` is always
  atomic per row in Postgres), so this is not actually a gap; it is listed here only to
  record that the guarantee rests on that specific Postgres property, not on any
  ordering promise this application code makes on its own.
- **(c) `pointerStore.getCurrent` fails on a call where a pointer row for today already
  exists.** `recorded` degrades to `null`. Unlike before this reordering, this is NOT a
  complete no-op: `create()` still runs (a wasted create, since this call was never going
  to have accurate information regardless), and the CAS below races a stale
  `expected: null` against the real (non-null) stored value — which fails, since the
  real adapter's `expected: null` condition is `local_date <> today`, false here. The
  call falls into the ordinary "lost the race" branch and terminates only the instance it
  just created for itself; the actually-current instance (whatever `recorded` would have
  named, had the read succeeded) is never touched, because it was never read and so is
  never named in a `terminate()` call at all — it simply keeps running, untouched, rather
  than being wrongly targeted. Costs latency only.
- **(d) The winner's request is interrupted after its CAS commits but before its
  `terminate(recorded)` call finishes.** This repo has seen exactly this shape of
  interruption before: PR #97, a Workers "Exceeded CPU Time Limits" cutting off an
  in-flight request mid-execution. Under create-before-CAS, the pointer has, by
  construction, already moved past `recorded` the instant the CAS commits — nothing
  about the ordering fix makes `recorded`'s cleanup itself atomic with the swap. If the
  request dies in that gap, `recorded` becomes a **permanent orphan**: no pointer value
  will ever name it again, so no future `restartToday` call, and no daily-Cron
  `ensureFor` repair pass (which only ever looks at the deterministic id and the
  pointer's *current* value), will ever rediscover it to terminate it. This is exactly
  the failure mode (a) above describes as "would never self-heal" and says this design
  avoids — (a) avoids it for the *CAS-unverifiable* case by treating the call as a loser
  before it ever wins, but that guard does nothing for a crash **after** a confirmed win.
  Considered and rejected: moving `terminate(recorded)` before `create()` closes this
  particular window but reopens a worse one — every CAS failure (e.g. a DB outage) would
  then self-terminate `recorded` before attempting to create its replacement, so an
  outage that fails every `restartToday` call for a user/day would leave that user/day
  with **zero** running instances instead of today's "at least `recorded` is still
  alive." Accepted as-is for now: an orphaned `recorded` instance is inert (it holds no
  pointer, `claimAttempt` still prevents it from double-sending anything it does
  dispatch) rather than harmful, and is bounded by the instance's own natural lifetime
  (it exits its loop once the local date rolls over, same as any instance). Not yet
  covered by an automated repair pass or an alert; a future change could have
  `ensureFor`'s daily sweep also `terminate()` any instance whose id is neither the
  deterministic one nor the current pointer value, closing this window without
  reintroducing the DB-outage problem above.
- **(e) A dormant sleeper outlives the schedules that justified it (fix/idle-instance-
  chain).** An instance already sleeping toward a future day D is never terminated or
  re-targeted when the user edits or deletes schedules — the restart path deliberately
  keeps touching only *today* (see W1' and the gate below). If the user deletes
  everything, that sleeper keeps sleeping until D, wakes, finds nothing, scans, gets
  `null`, and ends. The bound is its own already-scheduled wake day (worst case a
  checkpoint, so ≤ `CARE_CHAIN_HORIZON_DAYS`); in the meantime it costs one of the free
  plan's 100 concurrent instances and, on waking, 8 steps (see the step count above). Crucially it **does not
  self-perpetuate** — the symptom this fix exists to remove. Shrinking this to zero would
  require the pointer table to track "this user's current chain head" rather than
  "today's restart instance", putting the spawn and cron paths into the CAS that PR
  #101 only just got right, and adding a "terminate races a just-spawned head" family of
  interleavings. Explicitly declined; the user accepted the dormant window instead.
- **(f) Two chains can coexist briefly.** A transitional instance created by a restart on
  an idle day runs alongside whatever the cron/chain already created. They converge by
  construction (W1': deterministic ids for every future day, and a successor function
  that is a function of the calendar alone — including in the checkpoint branch, which is
  precisely what makes the merge unconditional rather than conditional on a firing day
  existing). The window is bounded by one horizon; `claimAttempt` prevents any duplicate
  send in the meantime.
- **(g) A badly overdue wake catches up in one hop — FIXED (`fix/overdue-wake-jump`).**
  If an instance wakes and the live local date is already *past* its own `localDate` (the
  platform delivered the wake late, or the instance sat unscheduled across an outage), the
  loop's exit condition is satisfied immediately and it hands off at once. It used to hand
  off to `nextCareChainDate(localDate)` — a day that could itself already be in the past,
  which would exit and hand off again: a fast run of instance creations, one per skipped
  day, bounded by nothing in this design.
  **The invariant now:** the hand-off is `planCareChainDateOnOrAfter(today)` — *every
  successor this loop creates is dated on or after today*, so no successor is ever born
  already overdue, and catch-up is one hop no matter how far behind the wake was. The
  cascade is closed off structurally, not bounded by a counter or a hop cap.
  **Where the rule lives, and why it has no branch.** `planCareChainDateOnOrAfter`
  (`care-day-chain.ts`, application layer) is the single literal definition of "the next
  care day counting today itself" for the two application-level callers: the chain
  hand-off and the restart gate (`hasUpcomingCareDate`). The daily cron is *not* one of
  them — it only holds a flat schedule array, never a repo, so it repeats the same
  `previousLocalDate(today)` shift independently in `ensure-care-day-instances.ts`; that
  is a second site this off-by-one must be tested and mutated at. The domain's
  `nextCareChainDate` is untouched: "strictly after this anchor" is what makes it
  composable, and the on-or-after shift is a use-case concern. The hand-off is
  **unconditional**, deliberately *not* `today > localDate ? … : localDate`: the loop's
  only exit is `plan === null`, which happens exactly when the live local date has moved
  past `localDate`, and the day-start wait guarantees `today >= localDate` before the loop
  is entered — so `today > localDate` is true on every reachable path and a conditional's
  two arms would be provably equal. That is a guard that cannot fail, the defect class
  this repo keeps regrowing.
  **The step name stays `spawn-next-care-day`** even though the anchor changed. The
  *cached value's* contract is unchanged ("the successor day this instance created, or
  `null`"), so a new name would signal nothing — and it could not reach an in-flight
  instance in any case: an instance is pinned to the Worker version it was created under
  (the Version column of `wrangler workflows instances list`, measured 2026-08-12), so it
  keeps executing the code it started with and never replays a redeployed step list.
  Renaming would be churn with no recipient, not a safety measure.
  **`final-mark-missed` is anchored on today too**, for the terminating-chain case: a
  terminating overdue instance is the last code that will ever run for that user, so
  sweeping only up to `localDate + 1` would lose any occurrence a transitional instance
  materialized on a jumped-over day. Without overrun the widening is inert (a `null`
  answer from today means no enabled schedule is active today, and the sweep skips
  disabled schedules anyway).
  **Guards:** `care-reminder-loop.test.ts`'s `fix/overdue-wake-jump` describe (8 days
  late → spawns today, in one hop; a Monday-only user 9 days late → the *next* Monday, not
  the intervening past one; a terminated chain still marks a jumped-over day missed) plus
  `planCareChainDateOnOrAfter`'s own unit tests. All run under `StrictWorkflowStep`.
  Mutation-verified in both directions: anchoring back on `localDate` and dropping the
  `previousLocalDate` shift each fail a distinct, named set of these tests.
  **New residuals accepted with the fix:**
  (i) *Midnight-boundary extra hop.* An instance spawned at, say, `23:59:59.9` can read
  its hand-off anchor on one local date and run its first step on the next, leaving it
  overdue by exactly one day. It then jumps once more and lands on today. The bound is
  one extra hop, never a cascade — the invariant above still holds for the successor.
  (ii) *Pushes for skipped days are unrecoverable, under any design.* This was always
  true and is now written down: walking never rescued them either. Each hop instance
  found `today !== localDate` at its first `plan-next-wake`, exited before
  `dispatch-due-rounds`, and materialized nothing. A reminder hours or days late is
  worse than none — the same judgement `FIRST_FIRE_GRACE_MINUTES = 10` already encodes.
  (iii) *Sweep timing on jumped-over days shifts, not disappears.* Occurrences a
  transitional instance left on a skipped day used to be swept by whichever hop passed
  over them; they are now swept by the successor's `mark-missed` when its target day
  begins — and when the successor *is* today, its day-start wait returns 0 and the sweep
  happens immediately — since `listPastUnlogged` is "every strictly-past unanswered
  occurrence", not "yesterday's". Later, never dropped — the same kind of delay the top-of-run
  `mark-missed` note already accepts.

`CareReminderWorkflow.run`
(now a thin wrapper around `care-reminder-loop.ts`'s `runCareReminderDay`, extracted so
it can run under a test double that actually rejects what the real Workflows API
rejects — see Testing below):

1. `step.do("mark-missed")` — `markMissedForUserDay` (moved from every Cron tick to
   once per instance-day; same insert-if-absent semantics, unchanged frequency-per-slot
   since a slot only ever needs marking once). Stays first, ahead of step 2 (W1').
2. `step.do("plan-day-start-wait")` + `step.sleep("sleep-until-day-start")`, in a loop
   — 0 and no sleep at all for an instance owning today; otherwise sleep to this
   instance's own `localDate` 00:00 and re-check (waking early, or into a DST shift,
   just computes a smaller wait; `utcInstantFor` resolves a gap to the first legal
   instant after it, so this cannot spin at 0ms). Required by W1' — without it a
   future-dated instance exits instantly and cascades.
3. Loop: `step.do("plan-next-wake")` (`buildSlotSnapshots` + `planNextWake`, returning
   both the planned wake instant and the instant it was planned at) → if the wake is
   still in the future, `step.sleep` for that **relative** duration; if it is already
   due (`planNextWake` legitimately returns "now" for a slot inside
   `FIRST_FIRE_GRACE_MINUTES`, or an overdue retry), skip sleeping and dispatch
   immediately → `step.do("dispatch-due-rounds")` (`dispatchDueRounds`) — until the
   local date `buildSlotSnapshots` re-derives from the live clock no longer matches
   `params.localDate`, the day this instance was spawned to own, at which point the
   step returns `null` and the loop exits. **This must compare against the instance's
   own `params.localDate`, not against a value re-derived from the same clock read
   `planNextWake` itself also uses inside the same step** — two computations of the
   same `now`/`timeZone` can never disagree, so a same-step self-comparison is
   structurally unreachable and the loop would never exit (an earlier revision of
   this change had exactly that bug: the exit step could never run). Mutation-
   verified in both directions in `care-reminder-loop.test.ts`'s "BLOCKER" describe
   block: forcing the exit check to always-false (never exits) hits the free-plan
   step-budget ceiling instead of resolving; forcing it always-true (exits
   immediately) fails the assertion that the day's own slot got dispatched before
   the exit.

   **No more `step.sleepUntil`.** The original design called `sleepUntil` with the
   wake instant `planNextWake` computed; the real Workflows API rejects `sleepUntil`
   for any instant that has become the past by the time the step actually executes,
   which a due-now-and-inside-grace slot always is (Cloudflare error: `You can't sleep
   until a time in the past, time-traveler`) — it crashed the instance outright,
   killing every reminder still owed that day. Switching to a **relative** `step.sleep`
   removes the failure mode at its root: a positive duration has no "already in the
   past" to be rejected for.

   **Busy-loop floor.** An immediately-due wake dispatches with no sleep at all, which
   could in principle busy-loop against the free plan's 3,000-steps/day ceiling. The
   loop tracks whether the **previous** round actually changed anything (a signature
   over the relevant slots' `lastAttemptAt`/`lastSendOutcome`/answered state, compared
   between consecutive `plan-next-wake` results) — not a raw count of consecutive
   immediate wakes. Two different slots both inside their own grace window legitimately
   produce two consecutive immediate wakes with real progress each time and must not be
   delayed; only a genuinely stuck round (no state changed since the last plan) falls
   back to a fixed 5-minute floor. Worst case with the floor engaged: ~288 rounds/day x
   3 steps ≈ 900, comfortably under budget — a 1-minute floor would not be (1,440
   rounds x 3 > 3,000).
4. `step.do("spawn-next-care-day")` — asks `planCareChainDateOnOrAfter` (W1') for the
   next day this user actually has something scheduled **on or after the live local
   date**, not anchored on this instance's own `localDate`, and creates that day's
   instance by its deterministic id; an id collision (the daily cron's repair pass, or
   another chain, beat it there) is silently ignored. Reading the clock here is safe for
   replay: it happens *inside* the step callback, so the value is captured in the step's
   cached result and the `null` branch below still depends only on that cached output.
   When the answer is `null` nothing is created and the chain ends — followed by
   `step.do("final-mark-missed")`, likewise anchored on the live local date, since no
   successor exists to do it. The step is named for what it does now rather than
   for the retired `spawn-tomorrow` it replaced, and it has deliberately *not* been
   renamed again since, because its cached-value contract did not change when its anchor
   did. Note what does *not* motivate either decision: an in-flight instance is pinned to
   the Worker version it was created under (measured 2026-08-12 via the Version column of
   `wrangler workflows instances list`), so it never replays cached step results against a
   redeployed step list, and no rename can reach it — see residual risk (g).

A daily Cron (`ensureCareDayInstances`, `wrangler.toml`'s `crons = ["5 16 * * *"]` ≈
00:05 Asia/Taipei) is the safety net: it groups every enabled schedule by user, asks the
**same** `nextCareChainDate` the chain itself uses (with today eligible), and calls
`ensureFor` for that day — a no-op when that instance already exists, and nothing at all
when the answer is `null`. A broken chain (an instance crashed without reaching its exit
step, or was terminated) self-heals within 24h. First deploy has no chain yet — the
PR/deploy checklist below covers bootstrapping it.

The old invariant here was "the cron's net is wider than the loop's" (it created today's
instance unconditionally). That is retired and replaced by a sharper one: **the successor
function is a function of the schedule calendar alone, never of the anchor's position,
so the cron and the chain cannot disagree about which day should own an instance** —
even though the cron anchors on `previousLocalDate(today)` and the chain anchors on its
own `localDate`. Spelling out why that holds for both branches, since "they call the same
function" alone does **not** imply it (a function can still be anchor-sensitive):
- *Firing-day branch:* for anchors `a1 < a2`, the days scanned from `a2` are a subset of
  those scanned from `a1`, so the two agree whenever `a2` has not yet passed the answer.
  On the day the answer arrives, cron's anchor is `answer - 1` and it re-derives the same
  `answer` — an `ensureFor` that no-ops against the instance already running it.
- *Checkpoint branch:* the answer is the next day on the global 90-day grid, which every
  anchor inside the same grid cell maps to identically. On the grid day itself, cron
  (anchor `c - 1`) re-derives `c` and no-ops; from `c + 1` onward both cron and the
  instance that ran on `c` name `c + 90`.

The cron still recomputes daily, so any break is repaired within 24h. Repair also got
*better*: because a repaired instance may be created for a future day and simply waits
for it (step 2 above), a day is now covered from its own 00:00 rather than from whenever
the cron happened to fire.

**Immediate-effect restarts create a NEW instance id, not the deterministic one, but
now find and terminate the PREVIOUS restart's instance too (fix/restart-instance-
tracking).** `restartToday` (`WorkflowsCareDayInstanceManager`) reads
`care_day_instance_pointer` for `(userId, localDate)`, `create()`s a fresh
`care-day_{userId}_{localDate}_r{randomUUID}` instance FIRST, only then compare-and-swaps
the pointer to that id, and only once that swap has won does it best-effort `terminate()`
whatever the pointer named before (falling back to the deterministic id too, when it
differs — e.g. on the day's first restart, cleaning up the instance the daily Cron's
`ensureFor` created). The new id is deliberately **not** the deterministic one: the
real Workflows API rejects `create()` for any id used before, even one that was just
`terminate()`d, for as long as it stays within its retention window, so the original
terminate-then-create-same-id sequence's `create()` call failed on **every single
restart**, not as an edge case (PR #98). `randomUUID`, not `Date.now()`, because two
restarts inside the same millisecond would collide with each other for the identical
reason.

**Create-before-CAS, not CAS-before-create — this is the load-bearing ordering decision
of this fix's second round.** A first attempt at this fix wrote the pointer BEFORE
`create()`, then re-read the pointer after `create()` resolved as a "reconciliation"
check, on the theory that a later call superseding it in between could be caught after
the fact. Code review found that ordering unsound (see the retired analysis this section
used to contain); a probe test forcing a further interleaving proved it: the superseding
call's own `terminate()` on the not-yet-created id was a silent no-op, and the
superseding call's CAS could still win before the original call's own reconciliation
check ran — so BOTH instances survived. **Reordering to create-then-CAS removes the bug
class instead of patching around the interleaving that exposed it**: because the pointer
is only ever advanced to an id AFTER that id has already been successfully created, no
caller can ever read a pointer value that names something not yet real. Every `terminate()`
call this method makes — on `recorded` (something a CAS write, by construction, always
wrote only after creating it) or on `newId` (which this call created moments earlier) —
is therefore always a real termination, never a no-op racing a not-yet-finished
`create()`. No post-CAS reconciliation step is needed, or exists, in this design.

**The tradeoff: every call now unconditionally `create()`s before it knows whether it
will "win".** A call that loses the CAS (or can't tell — see `restartToday`'s `wonRace`
variable, and residual risk (a) above) has already created an instance nobody will ever
point at, and must terminate it itself. That is one wasted create+terminate pair per lost
race — strictly worse than the previous design's "the loser skips `create()` entirely"
for the *same-read* race, but the previous design did not actually cover the *sequential*
race at all, so this trades a small, always-bounded cost for closing a real gap.

**Concurrency, same-read race: `setCurrentIfMatch` is a compare-and-swap, not a
read-then-write.** Two `restartToday` calls landing at once for the same user both read
the identical pointer value, both `create()` their own new id, then both attempt to swap
the pointer to it conditioned on the exact value they read. Postgres serializes the two
`INSERT ... ON CONFLICT ... setWhere` statements, so only one swap can succeed; the
winner terminates the old (`recorded`) instance, the loser terminates the instance it
just created for itself (both terminations are always real — see above).
`workflows-care-day-instance-manager.test.ts`'s "two concurrent restartToday calls ...
leave exactly one instance running" forces this exact interleaving with a barrier on the
pointer read (both calls must observe the *same* pre-write state before either writes)
rather than relying on `Promise.all` happening to schedule that way; `test/db/
care-day-instance-pointer.test.ts` separately proves the CAS primitive itself is atomic
against a real concurrent PGlite Postgres, the same relation `test/db/
care-occurrence-claim.test.ts` bears to `claimAttempt` below.

**Concurrency, sequential race: the case the round-1 fix got wrong.** The CAS only
guarantees `newId` was current at the instant `setCurrentIfMatch` committed; under
create-before-CAS, that instant is also always AFTER `newId` was successfully created.
A second `restartToday` can start any time after the first call's CAS commits,
legitimately read the first call's pointer value as `recorded`, `create()` its own id,
and win its own CAS against `expected: <first call's newId>` — and when it then
terminates that id, the termination is real, because create-before-CAS guarantees it was
already created before it could ever become a `recorded` value for anyone to read.
Exactly one instance survives, and the first call itself has nothing left to do (it
already returned once its own CAS resolved). `workflows-care-day-instance-manager.
test.ts` covers this with two tests: "a restart whose own create() is slow loses its CAS
to a later restart that finished first, and tears its own (unclaimed) instance back down"
(the direct analogue of the original round-1 regression test, restated for the new
ordering) and "a later restartToday's terminate() of a just-superseded id is a REAL
termination (not a no-op), even when it races the superseded call's own cleanup" (forces
a later call to terminate an id while the call that created it is still paused,
mid-cleanup, proving the termination lands on a real instance rather than racing an
unfinished `create()`). A third test, "invariant sweep: any number of concurrent
restartToday calls ... leave at most one instance running", checks the same property —
`runningIds().length <= 1` — across several unforced concurrent schedules rather than one
hand-picked interleaving (mutation-verified: reverting to CAS-before-create, or
defaulting `wonRace` to `true`, or skipping the loser's self-terminate, each turns at
least one of these tests red).

- **`claimAttempt` (D6'' below) remains the dispatch-side backstop regardless.** Even
  though the pointer/CAS above restores "one instance per (user, local day)" as the
  steady state, `claimAttempt` is not made redundant by it: the accepted residual risk
  (a) above, a genuinely concurrent restart edge case, or any future change to this path
  could all still transiently produce more than one live instance for a user/day, and
  `claimAttempt` is what prevents any of those from ever producing a duplicate send —
  not "only one instance exists," which this fix narrows the exposure to but does not
  promise as an absolute guarantee at the Workflows-API level.
- Failing at `create()` for a genuinely different reason (not the expected
  already-used-id case, which no longer applies here since the id is always fresh) is
  still swallowed and logged — same as before — costing at most today's remaining
  latency; the daily Cron's repair pass and the chained spawn from a still-running
  prior instance both self-correct within 24h.

## Key decisions

### D6'' — atomic dispatch claim (revises D6; supersedes this repo's own earlier D6' draft)

D6 explicitly declined a DB-level claim because Cron's non-concurrency made one
unnecessary. Workflows steps replay, so a claim is now required. The **first** draft
of this claim (written before user review) was a plain compare-and-swap: claim
succeeds only when `last_attempt_at IS NOT DISTINCT FROM $expected`. **That draft was
rejected in review** and does not ship: a CAS makes a claim that wins but never
completes (crash between claiming and sending) permanently stuck for the rest of the
day whenever `nag_interval_minutes = 0` — no later round would ever see the exact
"expected" value again to retake it. Real numbers: 4 of the 8 medication schedules in
this deployment are `nag = 0`; a CAS would leave half of all reminders with a silent
"claimed but never sent, never retried" failure mode the current per-minute Cron does
not have.

**What ships**: `CareOccurrenceRepository.claimAttempt(id, { at, leaseMinutes })` —
```sql
UPDATE care_occurrence
SET last_attempt_at = $at
WHERE id = $id AND (last_attempt_at IS NULL OR last_attempt_at <= $at - $leaseMinutes)
```
returning whether *this* call's row was affected. A **leased** claim: a replay within
the lease still loses (no double-send); a claim that never resolved (crashed before
`recordAttempt`) is retakeable once the lease elapses.

**`leaseMinutes` is derived per-round, not hardcoded to `RETRY_INTERVAL_MINUTES`.**
This was found and fixed during implementation, pinned by tests: `dispatchSlot` derives
`leaseMinutes` from the exact same interval `nextDueAt` just used to decide the round is
due (the schedule's own `nagIntervalMinutes` for a round following a successful send;
`RETRY_INTERVAL_MINUTES` — via `Math.max(nag, RETRY_INTERVAL_MINUTES)` — for
failed/expired/`no_subscriptions`/an unresolved claim). A flat 10-minute lease looked
correct against the user-approved gate scenario (an abandoned claim, `nag = 0`,
retaken 12 minutes later) but silently broke every schedule whose successful-send nag
interval is *shorter* than 10 minutes (this deployment has `nag = 5` on two
schedules): the previous, already-*resolved* attempt would still look "within lease"
under a flat 10-minute window, so the next legitimate (not abandoned) nag round could
never win its claim. Deriving the lease from `due - lastAttemptAt` keeps the claim
exactly as permissive as the due-check that just passed, while still rejecting a
same-round replay (whose `at` has not moved past `due` at all). `claimAttempt`'s
condition is non-strict (`<=`, not `<`) so a round due at exactly `T` is claimable at
exactly `T` — matching the due-check's own `now >= due`.

Tests (`test/db/care-occurrence-claim.test.ts`, PGlite): (a) two concurrent claimants
on a fresh row — exactly one wins; (b) a second claimant loses while the first claim's
lease has not expired; (c) a second claimant **wins** once the lease has expired — the
entire reason the lease exists, not a CAS. Mutation-verified: reverting the lease
condition to a plain `IS NULL` check turns (c) red.

**This claim remains load-bearing for more than replay safety, as defense in depth.**
`fix/restart-instance-tracking` (see W1 above) restores "one instance per (user, local
day)" as the steady state, including across concurrent `restartToday` calls — but its
own accepted residual risk (a), or any future change to this path, could still
transiently produce more than one live instance for a user/day, and `claimAttempt` is
what prevents any of those from ever producing a duplicate push notification — not "one
instance per day" alone. The PGlite tests above prove the claim primitive is atomic
against a real concurrent Postgres; they do not exercise two actual workflow loops
racing each other. A dedicated loop-level test
does: `test/contexts/notifications/adapters/care-reminder-loop.test.ts`'s "two
instances racing the same user/day never double-send" runs two `runCareReminderDay`
executions concurrently over one shared set of in-memory repositories and asserts a
due slot is sent exactly once. Mutation-verified: forcing `claimAttempt` to always
return `true` turns it red.

### D1' — local→UTC conversion is for sleeping only, never for deciding "is it due" (extends D1)

D1's rule — never convert a schedule time to a UTC instant, compare local wall-clock
strings instead — still governs every *due* decision (`localMinute`/`localParts`,
unchanged). What's new is that a sleep-based instance also needs to know **how long to
sleep**, which does require a local→UTC instant: `shared-kernel/reminder-clock.ts`
gains `utcInstantFor(localDate, hhmm, timeZone)`. Algorithm: sample the timezone's
offset a day before/after the target wall-clock value; equal offsets (the common case)
solve directly; unequal offsets mean a DST transition falls within that window —
binary-search it to minute resolution, then: both a before- and after-offset candidate
round-trip back to the requested wall-clock time → **fall-back overlap**, return the
**earlier** occurrence; neither does → **spring-forward gap**, return the transition
instant itself (the first legal instant after the gap); exactly one does → the
ordinary case despite the nearby transition.

**Every wake re-derives everything from scratch (D1's own discipline, extended, not
replaced).** `planNextWake`/`dispatchDueRounds` are called fresh on every wake with the
*actual* wake time (`new Date()`), never a value computed before `sleepUntil` — a wake
that runs early or late (Workflows makes no hard real-time guarantee) is handled
because "is it due" is re-derived from the live DB state and the live clock, not
trusted from the sleep target. `utcInstantFor` is used exactly once per wake cycle (to
plan the *next* sleep target) and never cached across a sleep.

Tests: `America/New_York` 2026-03-08 (spring-forward: `02:30` never occurs → resolves
to `07:00Z`, the first instant after the gap) and 2026-11-01 (fall-back: `01:30` occurs
twice → resolves to the earlier, `05:30Z`), plus ordinary-day round-trips in both zones
and a `planNextWake` test that exercises the gap case end-to-end.

### D3/D11/D12'' — FIRST_FIRE_GRACE and the retry floor are two gates, never the same one

D3 (Slice 2's cross-midnight look-back, superseded by Slice-3's same-day-only
`LOOKBACK_MINUTES = 5`) and D11's nag-retry semantics both governed "how late is too
late" in the old per-minute model, where the gap between ticks was always ≤1 minute
and a miss meant a skipped Cron invocation. In a sleep-based model the gap between
"scheduled" and "actually ran" can be minutes wide even in the ordinary case, so the
old 5-minute look-back is replaced by **`FIRST_FIRE_GRACE_MINUTES = 10`** — user-set,
not the 30-minute figure an earlier draft proposed (a medication reminder arriving 25
minutes late can be worse than one that never arrives at all).

**The load-bearing rule, and the reason this repo keeps re-deriving it in review**:
`FIRST_FIRE_GRACE_MINUTES` gates **only** whether a slot that has never been
materialized today may still be created this round. It is consulted exactly once, in
`dispatchSlot`'s `if (!occurrence)` branch, and **never again** — a materialized
occurrence's next-due timing is entirely `nextDueAt`'s job (the schedule's own
`nagIntervalMinutes` after a success; `RETRY_INTERVAL_MINUTES` — via `Math.max(nag,
RETRY_INTERVAL_MINUTES)` — after a failure/expiry/`no_subscriptions`/an abandoned
claim). Because both constants are 10, an implementation that (even accidentally)
re-checks the grace window on the already-materialized path is invisible under most
inputs — the two numbers agree almost everywhere. It is only visible on a fixture built
specifically to separate them: `test/.../run-care-day.test.ts`'s "an abandoned claim
(past the grace window) is still retried, not silently dropped" — a slot claimed at
`T`, crashed before `recordAttempt`, retried at `T+12min` (past both 10-minute windows,
but by construction *only* the retry floor should gate it). Mutation-verified: moving
the grace check to run unconditionally (not just on the `!occurrence` branch) turns
three tests red, including this one.

### D12' — `no_subscriptions` no longer "unconditionally due every tick"

D12 made a zero-subscription round retry every single Cron tick (free in a per-minute
model) so a subscribe at `09:01` got the `09:00` reminder within the minute. A
sleep-based instance cannot busy-loop for free: `no_subscriptions` now retries at the
ordinary `RETRY_INTERVAL_MINUTES` floor, like a failed/expired round. The "subscribe at
09:01, get the 09:00 reminder immediately" behavior is preserved by a **different**
mechanism instead — `subscribeWebPush` now best-effort restarts today's instance AND
calls `CareOccurrenceRepository.expediteNoSubscriptionsRetry(userId, localDate)`,
which rewinds `last_attempt_at` (to the epoch) on every occurrence still stuck on
`no_subscriptions` for that day. **Both halves are required**: restarting the instance
alone re-runs `planNextWake`/`dispatchSlot` against the *same* occurrence rows and so
recomputes the exact same `RETRY_INTERVAL_MINUTES`-out due time — it is
`expediteNoSubscriptionsRetry` mutating those rows, not the restart itself, that makes
the next wake see the slot as immediately due. This call is scoped to
`subscribeWebPush` only (not the schedule/timezone-change restart paths), since only a
fresh subscription can make a `no_subscriptions` slot's outcome stale.

### D7' — the daily Cron's job changes from "dispatch" to "repair"

`wrangler.toml`'s `[triggers]` drops from `* * * * *` to `5 16 * * *` (once daily,
≈00:05 Asia/Taipei); `scheduled` now calls `ensureCareDayInstances` instead of
`runCareTick`. D7's actual point — `fetch` and `scheduled` share one `buildDeps`/
`getCached` so the two entry points never drift — still holds, and now extends to
`CareReminderWorkflow`: its `run` calls the **same** exported `getCached(this.env)` as
`fetch`/`scheduled`, not a separate `buildDeps` call. `getCached`'s cache key is `env`
by object identity; a `WorkflowEntrypoint`'s `this.env` is not guaranteed to be the
same object `fetch` sees in the same isolate. If it isn't, the only cost is one extra
`deps` build (a cache miss) — never stale secrets, since `buildDeps` still reads
directly from whichever `env` it was actually called with.

**Immediate-effect hooks (not in the original design at all).** Schedule
create/update/delete, `PUT /api/user/timezone`, and a new push subscription now
best-effort call `CareDayInstanceManager.restartToday` (terminate + recreate today's
instance) after a successful write. Failures here are swallowed — never surfaced to
the HTTP caller — because the daily repair Cron and the instance's own chained spawn
are the durable paths; this is a latency improvement only, bounded above by "wait for
the instance's own next wake" if it fails.

**The restart gate (fix/idle-instance-chain).** `restartCareDayBestEffort` now returns
early — before `expediteNoSubscriptionsRetry`, before `restartToday` — when the caller
has **no upcoming care day at all** (`hasUpcomingCareDate`, i.e. `nextCareChainDate`
with today made eligible via `previousLocalDate`). Without it, deleting the last
schedule would immediately seed a fresh instance for a day with nothing in it. Three
properties are deliberate:
- it is **skip-only**: it can prevent a restart, never redirect one;
- it asks about *any* future day, **not** "is today active" — a user whose reminders
  start next week must still get their restart (mutation-verified in both directions);
- when today happens to be idle but a later day is not, it still restarts **today's**
  instance. That instance sleeps to midnight and its `spawn-next-care-day` step jumps
  the chain to the right day, costing one transitional ≤24h instance. Creating the
  future-dated instance directly instead would require the pointer table to stop meaning
  "today" — see residual risk (e).

## Testing

- `test/shared-kernel/reminder-clock.test.ts`: `utcInstantFor` ordinary-day round-trips
  (Asia/Taipei, America/New_York) and both 2026 US DST transitions;
  `nextLocalMidnightInstant` in a no-DST zone and across a DST-transition day;
  `epochDayOf` at/around the epoch and advancing by exactly 1 per calendar day over a
  year boundary (the property the checkpoint grid rests on).
- `test/contexts/notifications/application/run-care-day.test.ts` (replaces
  `run-care-tick.test.ts`, same in-memory-fake style, all prior scenarios migrated):
  `dispatchDueRounds` (materialize/dispatch/nag/retry-floor/grace/claim-loss/isolation/
  timezone-parameterization/dose-vs-note/outcome-summarization — the full three-branch
  nag matrix at 5/5/30/15-style intervals), `markMissedForUserDay` (enabled-but-
  not-active-today IS marked; disabled is NOT — matches the pre-existing
  `listActiveSchedules`-scoped behavior), `planNextWake` (pure, including the DST-gap
  case), `buildSlotSnapshots`.
- `test/db/care-occurrence-claim.test.ts` (PGlite): the three `claimAttempt` cases
  above.
- `test/contexts/notifications/domain/care-schedule.test.ts` (fix/idle-instance-chain):
  `nextCareChainDate` — daily → tomorrow, Mondays-only → the next Monday (not tomorrow),
  every-2-weeks anchored on `startDate` → the on-week, a future `startDate` → its first
  active day, an expired schedule → `null`, a disabled schedule → `null` (with the
  enabled counter-case green), earliest-across-schedules, never returning
  `afterLocalDate` itself, and both horizon outcomes (open-ended long interval →
  checkpoint day; same interval with an end date inside the horizon → `null`). Plus three
  "BLOCKER" cases for the grid property, which no single-anchor assertion can express:
  90 consecutive anchors yield **at most 2** distinct answers (anchor-relative gives 90);
  the cron's anchor on the checkpoint day re-derives that same day and then follows the
  chain's own successor for the next 90 days; and two chains anchored 18 days apart land
  on the same checkpoint. Mutation-verified: scanning from `afterLocalDate` inclusive,
  dropping the `enabled` filter, inverting the checkpoint condition, restoring the
  anchor-relative checkpoint (`? date :` instead of `? checkpoint :`), and decoupling the
  grid modulus from the horizon each turn the matching cases red.
- `test/contexts/notifications/application/care-day-chain.test.ts`: the two thin
  wrappers, including that `hasUpcomingCareDate` counts **today** (dropping the
  `previousLocalDate` shift turns it red — a user whose last care day is today would
  otherwise lose it).
- `test/contexts/notifications/application/ensure-care-day-instances.test.ts`: the cron
  targets today when today fires, **the next Monday** for a Mondays-only user asked on a
  Wednesday, nothing at all for an enabled-but-expired user, the earliest day across a
  user's schedules, each user's own timezone, and one user's failure not stopping the
  rest — plus a "BLOCKER" case running the cron on 20 consecutive days for a dormant
  (checkpoint-branch) user and asserting **one** distinct target across all of them, the
  end-to-end statement of the accumulation failure. Mutation-verified: reverting to
  "always today", removing the `null` skip, and restoring the anchor-relative checkpoint
  each turn their case red.
- Every load-bearing guard (grace-vs-retry separation, claim-result gating, the DST gap
  branch, the leased-claim expiry) is mutation-verified: the fix reverted, the
  corresponding test(s) go red, the fix restored.
- `test/contexts/notifications/adapters/care-reminder-loop.test.ts`: the extracted
  wake/dispatch loop (`runCareReminderDay`) under a **strict** step double
  (`strict-workflows-fakes.ts`'s `StrictWorkflowStep`) that actually rejects what the
  real Workflows API rejects — a non-positive `sleep` duration, and a step-count
  ceiling mirroring the free plan's 3,000 steps/day. Covers: a grace-window slot
  dispatches without ever attempting an invalid sleep (the direct regression test for
  the `sleepUntil`-on-a-past-instant crash); a not-yet-due slot sleeps a relative,
  positive duration; a `null` plan result breaks the loop and spawns the next care day
  without dispatching; sustained no-progress rounds fall back to the 5-minute busy-loop floor
  and stay within budget's shape; two genuinely-progressing immediate wakes in a row
  (two different slots both inside grace) are NOT delayed by that floor; two concurrent
  loop executions over shared state never double-send a slot (see D6'' above); and, for
  fix/idle-instance-chain, a Mondays-only user's midweek instance spawning **exactly**
  the next Monday rather than tomorrow, a fully-answered day still spawning its
  successor, a chain whose last schedule ends today spawning nothing **and** marking its
  own day missed, and a future-dated instance sleeping to its own day's 00:00 instead of
  exiting and cascading. Every one of these is mutation-verified (the corresponding fix reverted turns its test red,
  fix restored) — see the PR/commit for the exact mutations exercised.
- `test/contexts/notifications/application/care-items.test.ts` /
  `subscribe-web-push.test.ts`: the restart gate — no upcoming care day → neither
  `expediteNoSubscriptionsRetry` nor `restartToday` is called; today idle but a later day
  scheduled → `restartToday` **is** called (the reverse guard; a gate rewritten as "is
  today active" turns it red).
- `test/contexts/notifications/adapters/workflows-care-day-instance-manager.test.ts`:
  under a strict binding double (`StrictWorkflowBinding`) that rejects `create()` for
  any id used before (even a terminated one), `get()` for an unknown id, and — since
  fix/restart-instance-tracking — `terminate()` for an id that isn't currently running,
  each mirroring a real API limit whose absence let a bug ship undetected (the last one
  would otherwise hide a mutant that calls `terminate()` twice on the same instance).
  Covers: `restartToday` against an existing deterministic instance terminates it and
  **successfully** creates a new instance under a different id (the regression test for
  Bug B — the old code's `create()` failed every time under this double, silently,
  exactly as it did against the real API); `ensureFor`'s existing collision-is-a-no-op
  semantics is unchanged under the strict double; **three consecutive `restartToday`
  calls each terminate the PREVIOUS restart's instance, leaving `runningIds().length`
  at exactly 1 after every one** (fix/restart-instance-tracking's own regression test —
  mutation-verified: dropping the "terminate the recorded id" branch turns it red); a
  stale (yesterday's) pointer is ignored rather than mistaken for today's; a
  `pointerStore.getCurrent` failure degrades to "no recorded instance" without throwing,
  and (2nd round) does not mistakenly terminate the actually-current instance either,
  since it was never read; **`create()` runs BEFORE the pointer is ever written — a
  `create()` failure leaves the pointer AND the previously-current instance completely
  untouched** (2nd-round ordering regression test: seeds a real prior instance via a
  normal restart, forces the next restart's `create()` to fail, and asserts both the
  pointer and `runningIds()` are byte-for-byte unchanged — this is the test that would
  catch a revert to the round-1, CAS-before-create ordering, since that ordering
  terminates the old instance and moves the pointer BEFORE ever attempting `create()`);
  a `pointerStore.setCurrentIfMatch` failure still runs `create()` (new ordering) but
  immediately terminates the instance it just created, treating an unverifiable CAS as a
  loss (mutation-verified: defaulting the "did the CAS win" flag to `true` instead of
  `false` on that failure turns it red); **two concurrent `restartToday` calls, forced
  via a barrier to read the identical pre-write pointer state, leave exactly one
  instance running** — the same-read concurrency guard, checked as a count rather than
  pinned to one interleaving (mutation-verified: degrading `setCurrentIfMatch` to an
  unconditional write turns it red, and independently, dropping the real adapter's SQL
  `setWhere` clause turns `test/db/care-day-instance-pointer.test.ts`'s matching PGlite
  case red); for the *sequential* race the round-1 fix got wrong, three further tests —
  **"a restart whose own create() is slow loses its CAS to a later restart that finished
  first, and tears its own (unclaimed) instance back down"**, **"a later restartToday's
  terminate() of a just-superseded id is a REAL termination (not a no-op), even when it
  races the superseded call's own cleanup"** (this is the regression test for the exact
  bug a code-review probe found in the round-1, CAS-before-create-then-reconcile design:
  reverting to that ordering turns it red, since the analogous window there lets a
  terminate() land on an id that has not been created yet — a silent no-op), and the
  **"invariant sweep"** test, which runs several rounds of unforced concurrent
  `restartToday` calls and checks `runningIds().length <= 1` as an invariant rather than
  against one hand-picked schedule (mutation-verified together: reverting create-before-
  CAS to CAS-before-create, defaulting `wonRace` to `true`, or dropping the loser's own
  self-terminate each turn at least one of these three red).

## Platform limits this design relies on

Read from developers.cloudflare.com/workflows/reference/limits (free plan):
`step.sleep` up to a year per call; 1,024 steps per instance; 100 concurrent instances
per account; no cap on total instance duration. `CARE_CHAIN_HORIZON_DAYS = 90` keeps
every sleep an order of magnitude inside the first (deliberately — see W1'); a dormant
user costs 8 steps per checkpoint (mark-missed 1 + plan-day-start-wait 2 +
sleep-until-day-start 1 + plan-next-wake 2 + sleep-until-next-due 1 +
spawn-next-care-day 1 — counted off the run body below, not estimated) and one of the
100 concurrent slots, so the 1,024-step ceiling is nowhere near binding and the
concurrent-instance ceiling is the first thing that would bind if this app ever had
~100 simultaneously-active users. Nothing in this design assumes headroom beyond that.

**An in-flight instance keeps running the Worker version it was created under — this is
measured, not assumed.** After deploying PR #100 on 2026-08-12, `wrangler workflows
instances list care-reminder`'s **Version** column still showed the pre-deploy version
`1478db41-7215-49a4-ba6d-6bfe1f76f3b6` for instances created before the deploy, and
`1a80733d-482f-4143-a449-3385875832cb` for those created after. That column is the way
to check this on any future deploy.

The drain story is nevertheless written to hold under either assumption, because "the
instances we can see" is not the same as "all of them": an old-code instance spawns its
successor with old code, but that successor is a *new* instance running new code, which
then applies the new exit rule at its own midnight. Worst case the pre-existing daily
chain drains within two local midnights, with no manual cleanup.

## Deployment note

`wrangler.toml`'s cron/binding changes require a deploy. After deploying, **manually
trigger `scheduled` once** (Cloudflare dashboard "Trigger Event" or `wrangler dev
--test-scheduled`) to bootstrap the first day's instance for every existing user —
otherwise the first real instance only appears at the next scheduled Cron firing, up to
24h later. Expect Neon's "System operations" to start showing `Suspend compute` again
within a few days post-deploy (verifies the autosuspend regression this change exists
to fix).
