import { nextLocalDate } from "../../../shared-kernel/reminder-clock";
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
  spawnTomorrow: (tomorrowLocalDate: string) => Promise<void>,
  now: () => Date = () => new Date(),
): Promise<void> {
  const { userId, localDate, timezone } = params;

  await step.do("mark-missed", async () => {
    await markMissedForUserDay(userId, localDate, deps);
  });

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

  await step.do("spawn-tomorrow", async () => {
    await spawnTomorrow(nextLocalDate(localDate));
  });
}
