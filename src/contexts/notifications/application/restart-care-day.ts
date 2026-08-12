import { localParts } from "../../../shared-kernel/reminder-clock";
import type { UserRepository } from "../../user/domain/user-repository";
import type { CareDayInstanceManager } from "../domain/care-day-instance";
import type { CareOccurrenceRepository } from "../domain/care-occurrence";

/**
 * Best-effort immediate-effect hook (key_decisions "即時生效機制" in
 * replace-cron-with-workflows/design.md): restarts today's
 * `CareReminderWorkflow` instance for `userId` after a schedule/timezone/
 * push-subscription change, so it takes effect within seconds instead of
 * waiting for the instance's own next scheduled wake. Failures are
 * swallowed — the daily cron repair pass and the instance's own chained
 * spawn are the durable paths; this call must never affect the triggering
 * request's own outcome.
 *
 * Restarting the instance alone only makes it recompute due state from the
 * CURRENT occurrence rows — it does not, by itself, make a
 * `no_subscriptions` slot due any sooner (D12' relies on that slot's row
 * actually changing, not just on a fresh instance existing). `careOccurrenceRepo`
 * is therefore optional and passed only by the one caller — `subscribeWebPush`
 * — for which "a subscription may have just fixed a `no_subscriptions` slot"
 * is actually true; other callers (schedule/timezone changes) have no reason
 * to expedite an unrelated slot's retry.
 */
export async function restartCareDayBestEffort(
  userId: string,
  instanceManager: CareDayInstanceManager,
  userRepository: Pick<UserRepository, "getById">,
  careOccurrenceRepo?: Pick<CareOccurrenceRepository, "expediteNoSubscriptionsRetry">,
): Promise<void> {
  try {
    const timezone = (await userRepository.getById(userId))?.timezone ?? "Asia/Taipei";
    const localDate = localParts(new Date(), timezone).date;
    if (careOccurrenceRepo) await careOccurrenceRepo.expediteNoSubscriptionsRetry(userId, localDate);
    await instanceManager.restartToday(userId, localDate);
  } catch {
    // Best-effort only — never let a restart failure surface to the caller.
  }
}
