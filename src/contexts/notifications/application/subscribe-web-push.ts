import type { UserRepository } from "../../user/domain/user-repository";
import type { CareDayInstanceManager } from "../domain/care-day-instance";
import type { CareOccurrenceRepository } from "../domain/care-occurrence";
import type { PushSubscription, PushSubscriptionRepository } from "../domain/push-subscription";
import { restartCareDayBestEffort } from "./restart-care-day";

/**
 * Optional immediate-effect hook (key_decisions "即時生效機制" /
 * "no_subscriptions 分岔" in replace-cron-with-workflows/design.md): a fresh
 * subscription best-effort restarts today's instance AND expedites any
 * `no_subscriptions` slot for today, so it delivers within seconds instead
 * of waiting out `RETRY_INTERVAL_MINUTES`. `careOccurrenceRepo` does the
 * actual expediting (`restartCareDayBestEffort` alone does not — see its
 * doc comment); it is optional only so every existing caller keeps working
 * unchanged when not supplied, not because the near-instant delivery claim
 * holds without it.
 */
export interface SubscribeWebPushNotifyDeps {
  instanceManager: CareDayInstanceManager;
  userRepository: Pick<UserRepository, "getById">;
  careOccurrenceRepo?: Pick<CareOccurrenceRepository, "expediteNoSubscriptionsRetry">;
}

/** Use case: register (or, on a repeat `endpoint`, replace) a Web Push subscription for a user. */
export async function subscribeWebPush(
  repository: PushSubscriptionRepository,
  subscription: PushSubscription,
  notify?: SubscribeWebPushNotifyDeps,
): Promise<PushSubscription> {
  const result = await repository.upsert(subscription);
  if (notify) {
    await restartCareDayBestEffort(subscription.userId, notify.instanceManager, notify.userRepository, notify.careOccurrenceRepo);
  }
  return result;
}
