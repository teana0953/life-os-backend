# Design — Replace the per-minute Cron dispatch tick with Cloudflare Workflows

## Context & scope

Replaces `run-care-tick.ts` (a per-minute `[triggers]` Cron body) with
`CareReminderWorkflow`: one Cloudflare Workflows instance per (user, local day) that
sleeps until each of that user's reminders is due, dispatches it, and re-plans its next
wake — instead of every user on Earth being scanned every minute. The daily Cron
survives, downgraded from "dispatch everything" to "make sure today's instance exists."

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
defines a plain port (`ensureToday`/`restartToday`); only
`workflows-care-day-instance-manager.ts` and `care-reminder-workflow.ts` touch the
actual Workflows binding/types, keeping the dependency rule intact (CLAUDE.md).

**W1 — one instance per (user, local day).** Deterministic id
`care-day:{userId}:{localDate}`. `CareReminderWorkflow.run`:

1. `step.do("mark-missed")` — `markMissedForUserDay` (moved from every Cron tick to
   once per instance-day; same insert-if-absent semantics, unchanged frequency-per-slot
   since a slot only ever needs marking once).
2. Loop: `step.do("plan-next-wake")` (`buildSlotSnapshots` + `planNextWake`) →
   `step.sleepUntil` → `step.do("dispatch-due-rounds")` (`dispatchDueRounds`) — until
   `planNextWake` returns `null` (today's local date has rolled past).
3. `step.do("spawn-tomorrow")` — creates tomorrow's instance by its deterministic id;
   an id collision (the daily cron's repair pass beat it there) is silently ignored.

A daily Cron (`ensureCareDayInstances`, `wrangler.toml`'s `crons = ["5 16 * * *"]` ≈
00:05 Asia/Taipei) is the safety net: for every distinct (userId, timezone) with an
enabled schedule, `ensureToday` — a no-op when today's instance already exists. A
broken chain (an instance crashed without reaching step 3, or was terminated)
self-heals within 24h. First deploy has no chain yet — the PR/deploy checklist below
covers bootstrapping it.

`restartToday` (`WorkflowsCareDayInstanceManager`) is itself one specific way this can
happen: it `terminate()`s the existing instance, then `create()`s a fresh one; the
`create()` call is wrapped in a swallowing `catch` (deliberately — see its own doc
comment), so a `terminate()` that succeeds followed by a `create()` that fails for a
real reason (not the expected id-collision case) leaves the user with **no** running
instance for the rest of today, silently, until the same 24h daily-Cron repair pass
above picks it up. Accepted as part of the same known 24h self-heal window, not a new
risk — called out explicitly here because `restartToday` is the one path that can
itself create the gap it is meant to shrink.

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

## Testing

- `test/shared-kernel/reminder-clock.test.ts`: `utcInstantFor` ordinary-day round-trips
  (Asia/Taipei, America/New_York) and both 2026 US DST transitions;
  `nextLocalMidnightInstant` in a no-DST zone and across a DST-transition day.
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
- Every load-bearing guard (grace-vs-retry separation, claim-result gating, the DST gap
  branch, the leased-claim expiry) is mutation-verified: the fix reverted, the
  corresponding test(s) go red, the fix restored.

## Deployment note

`wrangler.toml`'s cron/binding changes require a deploy. After deploying, **manually
trigger `scheduled` once** (Cloudflare dashboard "Trigger Event" or `wrangler dev
--test-scheduled`) to bootstrap the first day's instance for every existing user —
otherwise the first real instance only appears at the next scheduled Cron firing, up to
24h later. Expect Neon's "System operations" to start showing `Suspend compute` again
within a few days post-deploy (verifies the autosuspend regression this change exists
to fix).
