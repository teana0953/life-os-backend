import type { PushSubscription, PushSubscriptionRepository } from "../domain/push-subscription";

/** Use case: register (or, on a repeat `endpoint`, replace) a Web Push subscription for a user. */
export async function subscribeWebPush(
  repository: PushSubscriptionRepository,
  subscription: PushSubscription,
): Promise<PushSubscription> {
  return repository.upsert(subscription);
}
