import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { describeErrorChain } from "../../../adapters/http/error-logging";
import { nextLocalDate } from "../../../shared-kernel/reminder-clock";
import { type Env, getCached } from "../../../index";
import {
  buildSlotSnapshots,
  dispatchDueRounds,
  markMissedForUserDay,
  planNextWake,
  type RunCareDayDeps,
} from "../application/run-care-day";
import { careDayInstanceId, type CareReminderWorkflowParams } from "./workflows-care-day-instance-manager";

/**
 * Driving adapter (Workflows entrypoint): a *thin* orchestrator only — every
 * decision (is this slot due, when should I wake next, what counts as
 * "missed") lives in `run-care-day.ts`'s plain functions, unit-tested with
 * fake repositories with no Workflows runtime involved (see R1 in
 * replace-cron-with-workflows/design.md). This class's only job is the
 * step/sleep/loop plumbing around them.
 *
 * D1' — every wake re-derives from scratch: `plan-next-wake` and
 * `dispatch-due-rounds` both read `new Date()` and the live DB state at the
 * moment they run, never a value carried over from before `sleepUntil`. The
 * loop's only memory across iterations is `event.payload` (userId/localDate/
 * timezone, fixed for this instance's whole day).
 */
export class CareReminderWorkflow extends WorkflowEntrypoint<Env, CareReminderWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<CareReminderWorkflowParams>>, step: WorkflowStep): Promise<void> {
    const { userId, localDate, timezone } = event.payload;
    const deps = getCached(this.env).deps;
    const careDeps: RunCareDayDeps = {
      careItemRepo: deps.careItemRepository,
      careLogRepo: deps.careLogRepository,
      careOccurrenceRepo: deps.careOccurrenceRepository,
      subscriptionRepo: deps.pushSubscriptionRepository,
      pushSender: deps.pushSender,
    };

    await step.do("mark-missed", async () => {
      await markMissedForUserDay(userId, localDate, careDeps);
    });

    for (;;) {
      const wakeIso: string | null = await step.do("plan-next-wake", async () => {
        const now = new Date();
        const { todayLocalDate, slots } = await buildSlotSnapshots(userId, timezone, now, careDeps);
        const wake = planNextWake(now, timezone, todayLocalDate, slots);
        return wake ? wake.toISOString() : null;
      });
      if (wakeIso === null) break; // todayLocalDate has rolled past — this instance's day is over.

      await step.sleepUntil("sleep-until-next-due", new Date(wakeIso));

      await step.do("dispatch-due-rounds", async () => {
        await dispatchDueRounds(new Date(), userId, timezone, careDeps);
      });
    }

    await step.do("spawn-tomorrow", async () => {
      const tomorrow = nextLocalDate(localDate);
      try {
        await this.env.CARE_REMINDER_WORKFLOW.create({
          id: careDayInstanceId(userId, tomorrow),
          params: { userId, localDate: tomorrow, timezone },
        });
      } catch (err) {
        // Expected outcome includes a deterministic id collision (e.g. the
        // daily cron's repair pass already created it), but also any real
        // Workflows API failure — log rather than risk staying silent.
        console.error("spawn-tomorrow: workflow.create failed", describeErrorChain(err));
      }
    });
  }
}
