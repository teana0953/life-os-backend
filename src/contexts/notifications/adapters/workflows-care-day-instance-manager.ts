import type { UserRepository } from "../../user/domain/user-repository";
import type { CareDayInstanceManager } from "../domain/care-day-instance";

/** Payload a `CareReminderWorkflow` instance is created with. */
export interface CareReminderWorkflowParams {
  userId: string;
  localDate: string;
  timezone: string;
}

/** Deterministic instance id: one instance per (user, local day) — W1 in design.md. */
function instanceId(userId: string, localDate: string): string {
  return `care-day:${userId}:${localDate}`;
}

/**
 * Driven adapter: implements `CareDayInstanceManager` via the
 * `CARE_REMINDER_WORKFLOW` Workflows binding. `Workflow<PARAMS>` is the
 * ambient global type `@cloudflare/workers-types` declares for a Workflows
 * binding — this is the one file allowed to import/reference it
 * (`domain`/`application` never see it, per this repo's dependency rule).
 *
 * Looks the user's timezone up fresh on every call (never cached) — a
 * `restartToday` triggered BY a timezone change must see the new value, not
 * a stale one captured before the change that triggered it.
 */
export class WorkflowsCareDayInstanceManager implements CareDayInstanceManager {
  constructor(
    private readonly workflow: Workflow<CareReminderWorkflowParams>,
    private readonly userRepository: Pick<UserRepository, "getById">,
  ) {}

  private async resolveTimezone(userId: string): Promise<string> {
    return (await this.userRepository.getById(userId))?.timezone ?? "Asia/Taipei";
  }

  async ensureToday(userId: string, localDate: string): Promise<void> {
    try {
      const timezone = await this.resolveTimezone(userId);
      await this.workflow.create({ id: instanceId(userId, localDate), params: { userId, localDate, timezone } });
    } catch {
      // Deterministic id collision = an instance already exists for today — the expected, silent outcome.
    }
  }

  async restartToday(userId: string, localDate: string): Promise<void> {
    const id = instanceId(userId, localDate);
    try {
      const handle = await this.workflow.get(id);
      await handle.terminate();
    } catch {
      // No existing instance to terminate (or it already finished) — fine, create fresh below.
    }
    try {
      const timezone = await this.resolveTimezone(userId);
      await this.workflow.create({ id, params: { userId, localDate, timezone } });
    } catch {
      // Best-effort (key_decisions "即時生效機制"): a failure here costs at
      // most today's remaining latency — the daily cron and the chained
      // spawn from a still-running prior instance both self-correct.
    }
  }
}
