import { describeErrorChain } from "../../../adapters/http/error-logging";
import type { UserRepository } from "../../user/domain/user-repository";
import type { CareDayInstanceManager } from "../domain/care-day-instance";

/** Payload a `CareReminderWorkflow` instance is created with. */
export interface CareReminderWorkflowParams {
  userId: string;
  localDate: string;
  timezone: string;
}

/**
 * Deterministic instance id: one instance per (user, local day) — W1 in
 * design.md. Cloudflare Workflows instance ids must match
 * `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` (max 100 chars) — `:` is NOT allowed, so
 * `_` separates the fields (both `userId` and `localDate` already contain
 * `-`, so `_` keeps the field boundaries readable).
 */
export function careDayInstanceId(userId: string, localDate: string): string {
  return `care-day_${userId}_${localDate}`;
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
      await this.workflow.create({
        id: careDayInstanceId(userId, localDate),
        params: { userId, localDate, timezone },
      });
    } catch (err) {
      // Expected outcome includes a deterministic id collision (an instance
      // already exists for today), but also any real Workflows API failure —
      // there's no documented way to tell them apart from the error shape,
      // so log everything rather than risk staying silent on a real failure.
      console.error("ensureToday: workflow.create failed", describeErrorChain(err));
    }
  }

  async restartToday(userId: string, localDate: string): Promise<void> {
    const deterministicId = careDayInstanceId(userId, localDate);
    try {
      const handle = await this.workflow.get(deterministicId);
      await handle.terminate();
    } catch {
      // No existing instance to terminate (or it already finished) — fine, create fresh below.
    }
    try {
      // A fresh suffixed id, NOT the deterministic one above: Cloudflare
      // rejects create() for any id used before, even a just-terminated one,
      // while it is still within its retention window — so re-creating with
      // `deterministicId` here would deterministically fail every single
      // time (goal.md Bug B). The suffix is `crypto.randomUUID()`, not e.g.
      // `Date.now()`, because two restarts in the same millisecond would
      // otherwise collide with each other for the exact same reason. This
      // does cost the "one instance per (user, local day)" id determinism on
      // THIS path only — see design.md's W1 section for the accepted
      // consequence (a restarted-away instance can't be found and terminated
      // by a later restart; multiple instances may run concurrently for a
      // while) and D6'' for why that no longer risks a duplicate send.
      const id = `${deterministicId}_r${crypto.randomUUID()}`;
      const timezone = await this.resolveTimezone(userId);
      await this.workflow.create({ id, params: { userId, localDate, timezone } });
    } catch (err) {
      // Best-effort (design.md's "即時生效機制"): a failure here costs at
      // most today's remaining latency — the daily cron and the chained
      // spawn from a still-running prior instance both self-correct. Logged
      // (not silenced) so a real failure here is still visible.
      console.error("restartToday: workflow.create failed", describeErrorChain(err));
    }
  }
}
