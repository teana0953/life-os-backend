import { localParts } from "../../../shared-kernel/reminder-clock";
import type { UserRepository } from "../../user/domain/user-repository";
import type { CareDayInstanceManager } from "../domain/care-day-instance";

/**
 * Best-effort immediate-effect hook (key_decisions "即時生效機制" in
 * replace-cron-with-workflows/design.md): restarts today's
 * `CareReminderWorkflow` instance for `userId` after a schedule/timezone/
 * push-subscription change, so it takes effect within seconds instead of
 * waiting for the instance's own next scheduled wake. Failures are
 * swallowed — the daily cron repair pass and the instance's own chained
 * spawn are the durable paths; this call must never affect the triggering
 * request's own outcome.
 */
export async function restartCareDayBestEffort(
  userId: string,
  instanceManager: CareDayInstanceManager,
  userRepository: Pick<UserRepository, "getById">,
): Promise<void> {
  try {
    const timezone = (await userRepository.getById(userId))?.timezone ?? "Asia/Taipei";
    const localDate = localParts(new Date(), timezone).date;
    await instanceManager.restartToday(userId, localDate);
  } catch {
    // Best-effort only — never let a restart failure surface to the caller.
  }
}
