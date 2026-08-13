import { localParts } from "../../../shared-kernel/reminder-clock";
import type { UserRepository } from "../../user/domain/user-repository";
import type { CareDayInstanceManager } from "../domain/care-day-instance";
import type { CareOccurrenceRepository } from "../domain/care-occurrence";
import { type CareChainItemRepo, hasUpcomingCareDate } from "./care-day-chain";

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
  careItemRepo: CareChainItemRepo,
  careOccurrenceRepo?: Pick<CareOccurrenceRepository, "expediteNoSubscriptionsRetry">,
): Promise<void> {
  try {
    const timezone = (await userRepository.getById(userId))?.timezone ?? "Asia/Taipei";
    const localDate = localParts(new Date(), timezone).date;
    // Skip-only gate: a user with nothing left to fire — ever — gets no
    // instance at all, which is what stops a deleted/expired set of schedules
    // from being re-seeded here every time anything is edited. It is placed
    // BEFORE `expediteNoSubscriptionsRetry` deliberately: no upcoming care
    // day implies no occurrence today for that call to expedite anyway.
    //
    // Note it asks "any future care day", not "is today one" — when today is
    // idle but a later day is not, this still restarts TODAY's instance. That
    // instance sleeps to local midnight and then, via `spawn-next-care-day`,
    // jumps the chain to the right day. One transitional instance costs a
    // little; making restart create a future-dated instance instead would
    // have to move the pointer table off "today", reopening the CAS design
    // this deliberately leaves untouched (see design.md W1).
    if (!(await hasUpcomingCareDate(careItemRepo, userId, localDate))) return;
    if (careOccurrenceRepo) await careOccurrenceRepo.expediteNoSubscriptionsRetry(userId, localDate);
    await instanceManager.restartToday(userId, localDate);
  } catch {
    // Best-effort only — never let a restart failure surface to the caller.
  }
}
