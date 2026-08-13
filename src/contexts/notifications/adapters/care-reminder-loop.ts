import { localParts, nextLocalDate, utcInstantFor } from "../../../shared-kernel/reminder-clock";
import { planNextCareChainDate } from "../application/care-day-chain";
import { buildSlotSnapshots, dispatchDueRounds, markMissedForUserDay, planNextWake, type RunCareDayDeps, type SlotSnapshot } from "../application/run-care-day";

/**
 * Bug A fix (see goal.md): consecutive immediate (no-sleep) wakes with no
 * observable state change get pushed out to this floor instead of busy-
 * looping. 5, not a smaller value, is chosen for the free-plan step budget:
 * worst case ~288 rounds/day (24h / 5min) x 3 steps/round ≈ 900, comfortably
 * under Workflows' 3,000 steps/day free-plan ceiling — a 1-minute floor's
 * worst case (1,440 rounds x 3 > 3,000) would not be.
 */
const BUSY_LOOP_BACKOFF_MS = 5 * 60_000;

/**
 * Minimal subset of Cloudflare's `WorkflowStep` this loop needs. A real
 * `WorkflowStep` satisfies this structurally (no adapting required) — see
 * `CareReminderWorkflow`. Deliberately excludes `sleepUntil`: Bug A's fix is
 * to never call it (a relative `sleep` cannot be rejected for landing "in
 * the past" the way an absolute `sleepUntil` can).
 */
export interface CareReminderStep {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
}

export interface CareReminderLoopParams {
  userId: string;
  localDate: string;
  timezone: string;
}

/**
 * Cheap, order-independent fingerprint of the slots `planNextWake` just
 * considered — used ONLY to detect whether the round in between two
 * `plan-next-wake` calls actually changed anything (gate_decision #2: the
 * busy-loop backoff must key off "did the last round progress state", not a
 * raw consecutive-immediate-wake count). Built from the same `SlotSnapshot`
 * data `planNextWake` itself reads, not a re-derivation of its due-ness
 * rules, so it can never drift from what "progress" actually means there.
 */
function slotStateSignature(slots: SlotSnapshot[]): string {
  return slots
    .map((s) => `${s.schedule.id}:${s.answered}:${s.occurrence?.lastAttemptAt?.toISOString() ?? "-"}:${s.occurrence?.lastSendOutcome ?? "-"}`)
    .sort()
    .join("|");
}

/**
 * The wake/dispatch loop body of a `CareReminderWorkflow` instance-day, as a
 * plain function over a minimal step interface — extracted from the
 * Workflows entrypoint class so it can run under a strict, real-API-shaped
 * test double (see `test/contexts/notifications/adapters/strict-workflows-fakes.ts`)
 * instead of a permissive fake that would never catch what Bug A actually
 * was.
 *
 * D1'/replay-determinism: every branch below depends only on THIS loop's own
 * step outputs (`wakeIso`, `plannedAtIso`, `signature`) — never a fresh
 * `new Date()` read in the loop body itself. Workflows replays completed
 * steps by returning their cached results, not by re-running them; a branch
 * that read the live clock directly could disagree with itself across a
 * replay.
 */
export async function runCareReminderDay(
  params: CareReminderLoopParams,
  step: CareReminderStep,
  deps: RunCareDayDeps,
  spawnNext: (nextCareLocalDate: string) => Promise<void>,
  now: () => Date = () => new Date(),
): Promise<void> {
  const { userId, localDate, timezone } = params;

  // Stays FIRST, before the day-start wait below: a successor instance is
  // created at the previous care day's local midnight and starts running
  // immediately, so "yesterday's unanswered slots get marked missed at
  // midnight" keeps exactly the timing it had when every instance owned the
  // very next calendar day. Passing a `localDate` that is still in the future
  // only widens the `< localDate` window this marks, and the skipped days in
  // between normally have no occurrences to mark — only a day an instance
  // actually ran ever materializes one. Should a transitional restart instance
  // materialize some on a jumped-over day after this instance already passed
  // this step, nothing is lost: `listPastUnlogged` is "every strictly-past
  // unanswered occurrence", not "yesterday's", so the next instance sweeps
  // them up — late by at most one firing interval, never dropped.
  await step.do("mark-missed", async () => {
    await markMissedForUserDay(userId, localDate, deps);
  });

  // This instance may have been created for a FUTURE care day (the chain now
  // jumps straight to the next day something actually fires, and so does the
  // cron). Without this wait it would fall through to `plan-next-wake`, see
  // `todayLocalDate !== localDate`, exit at once, and spawn its own successor
  // — an unbounded same-instant cascade that would burn the whole step budget.
  // For an instance owning today (every instance before this change) the wait
  // is 0 and no `sleep` is issued at all — which is exactly what the strict
  // step double's rejection of a non-positive `sleep` guards.
  for (;;) {
    const waitMs = await step.do("plan-day-start-wait", async () => {
      const at = now();
      if (localParts(at, timezone).date >= localDate) return 0;
      return utcInstantFor(localDate, "00:00", timezone).getTime() - at.getTime();
    });
    if (waitMs <= 0) break;
    // Re-checked rather than assumed: waking a little early (or into a DST
    // shift) simply computes a new, smaller wait. `utcInstantFor` resolves a
    // gap to the first legal instant after it, so "now >= that instant"
    // always implies the local date has arrived — this cannot spin at 0ms.
    await step.sleep("sleep-until-day-start", waitMs);
  }

  let prevSignature: string | undefined;
  let noProgressStreak = 0;

  for (;;) {
    const plan = await step.do("plan-next-wake", async () => {
      const at = now();
      const { todayLocalDate, slots } = await buildSlotSnapshots(userId, timezone, at, deps);
      // This instance owns `localDate` (its spawn-time local day), not
      // whatever `buildSlotSnapshots` re-derives from the live clock — the
      // two are computed from the same `at` here and so can never disagree
      // with EACH OTHER, which is why comparing against `params.localDate`
      // (the day fixed at spawn time) is the only comparison that can ever
      // actually go false once real time moves past local midnight.
      if (todayLocalDate !== localDate) return null;
      const wake = planNextWake(at, timezone, todayLocalDate, slots);
      return wake ? { wakeIso: wake.toISOString(), plannedAtIso: at.toISOString(), signature: slotStateSignature(slots) } : null;
    });
    if (plan === null) break; // real local date has rolled past this instance's owned `localDate` — hand off to tomorrow.

    const { wakeIso, plannedAtIso, signature } = plan;
    const waitMs = new Date(wakeIso).getTime() - new Date(plannedAtIso).getTime();

    if (waitMs > 0) {
      // A genuine future wake — sleep for it (relative duration: Bug A's
      // fix. `sleepUntil` with an absolute past-turned timestamp is what
      // crashed the real instance; a positive relative `sleep` has no
      // "already in the past" failure mode to begin with).
      await step.sleep("sleep-until-next-due", waitMs);
      noProgressStreak = 0; // a real sleep happened — not a busy-loop round.
    } else {
      // Immediate wake (waitMs <= 0): either a slot within
      // FIRST_FIRE_GRACE_MINUTES of first-firing, or an overdue retry.
      // Whether to back off is decided by whether the LAST round actually
      // changed anything, not by counting immediate wakes — two different
      // slots both inside their own grace window legitimately produce two
      // consecutive immediate wakes with real progress each time (gate_decision #2).
      noProgressStreak = prevSignature !== undefined && signature === prevSignature ? noProgressStreak + 1 : 0;
      if (noProgressStreak >= 1) {
        await step.sleep("busy-loop-backoff", BUSY_LOOP_BACKOFF_MS);
      }
    }

    await step.do("dispatch-due-rounds", async () => {
      await dispatchDueRounds(now(), userId, timezone, deps);
    });

    prevSignature = signature;
  }

  // Hand off to the next day this user actually has something scheduled —
  // not unconditionally to tomorrow. A "every Monday" user's Monday instance
  // spawns next Monday directly instead of six instances that wake only to
  // find nothing and spawn again. The anchor is this instance's own
  // `localDate` (the scan starts the day after it), so when tomorrow IS a
  // care day the behaviour is identical to the old unconditional spawn.
  //
  // Step name deliberately differs from the retired `spawn-tomorrow`: an
  // in-flight instance replaying cached step results across a deploy must not
  // match an old step's output to this step's new meaning.
  const nextCareDate = await step.do("spawn-next-care-day", async () => {
    const target = await planNextCareChainDate(deps.careItemRepo, userId, localDate);
    if (target !== null) await spawnNext(target);
    return target;
  });

  if (nextCareDate === null) {
    // Nothing will ever fire again, so no successor exists to mark this day's
    // unanswered slots missed the way every other day's are. Only reachable
    // on a terminating chain; `upsertIfAbsent` still never clobbers a real
    // answer the user recorded.
    await step.do("final-mark-missed", async () => {
      await markMissedForUserDay(userId, nextLocalDate(localDate), deps);
    });
  }
}
