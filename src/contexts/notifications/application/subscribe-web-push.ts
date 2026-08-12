import type { UserRepository } from "../../user/domain/user-repository";
import type { CareDayInstanceManager } from "../domain/care-day-instance";
import type { PushSubscription, PushSubscriptionRepository } from "../domain/push-subscription";
import { restartCareDayBestEffort } from "./restart-care-day";

/**
 * Optional immediate-effect hook (key_decisions "即時生效機制" /
 * "no_subscriptions 分岔" in replace-cron-with-workflows/design.md): a fresh
 * subscription best-effort restarts today's instance, so a slot stuck on
 * `no_subscriptions` delivers within seconds instead of waiting out
 * `RETRY_INTERVAL_MINUTES`. Optional so every existing caller keeps working
 * unchanged.
 */
export interface SubscribeWebPushNotifyDeps {
  instanceManager: CareDayInstanceManager;
  userRepository: Pick<UserRepository, "getById">;
}

/** Use case: register (or, on a repeat `endpoint`, replace) a Web Push subscription for a user. */
export async function subscribeWebPush(
  repository: PushSubscriptionRepository,
  subscription: PushSubscription,
  notify?: SubscribeWebPushNotifyDeps,
): Promise<PushSubscription> {
  const result = await repository.upsert(subscription);
  if (notify) await restartCareDayBestEffort(subscription.userId, notify.instanceManager, notify.userRepository);
  return result;
}
