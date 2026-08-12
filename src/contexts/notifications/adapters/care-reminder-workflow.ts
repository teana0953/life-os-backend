import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { describeErrorChain } from "../../../adapters/http/error-logging";
import { type Env, getCached } from "../../../index";
import type { RunCareDayDeps } from "../application/run-care-day";
import { runCareReminderDay } from "./care-reminder-loop";
import { careDayInstanceId, type CareReminderWorkflowParams } from "./workflows-care-day-instance-manager";

/**
 * Driving adapter (Workflows entrypoint): a *thin* orchestrator only - every
 * decision (is this slot due, when should I wake next, what counts as
 * "missed") lives in `run-care-day.ts`'s plain functions, unit-tested with
 * fake repositories with no Workflows runtime involved (see R1 in
 * replace-cron-with-workflows/design.md). The wake/dispatch loop itself lives
 * in `care-reminder-loop.ts`'s `runCareReminderDay`, testable under a strict
 * step double that mimics real Workflows API limits (Bug A in goal.md) - this
 * class's only job is wiring `step`/`env` into it.
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

    await runCareReminderDay({ userId, localDate, timezone }, step, careDeps, async (tomorrowLocalDate) => {
      try {
        await this.env.CARE_REMINDER_WORKFLOW.create({
          id: careDayInstanceId(userId, tomorrowLocalDate),
          params: { userId, localDate: tomorrowLocalDate, timezone },
        });
      } catch (err) {
        // Expected outcome includes a deterministic id collision (e.g. the
        // daily cron's repair pass already created it), but also any real
        // Workflows API failure - log rather than risk staying silent.
        console.error("spawn-tomorrow: workflow.create failed", describeErrorChain(err));
      }
    });
  }
}
