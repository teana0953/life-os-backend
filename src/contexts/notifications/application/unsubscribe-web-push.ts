import type { PushSubscriptionRepository } from "../domain/push-subscription";

/** Use case: remove a Web Push subscription by endpoint. Idempotent: a non-existent endpoint is a silent no-op. */
export async function unsubscribeWebPush(
  repository: PushSubscriptionRepository,
  userId: string,
  endpoint: string,
): Promise<void> {
  await repository.deleteByEndpoint(userId, endpoint);
}
