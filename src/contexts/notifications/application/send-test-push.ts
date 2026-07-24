import type { PushSender } from "../domain/push-sender";
import type { PushSubscriptionRepository } from "../domain/push-subscription";

/** A fixed, generic test message — no personal data (per design "Privacy / security"). */
export const TEST_MESSAGE = { title: "LifeOS 測試通知", body: "這是一則測試推播，確認裝置能正常接收通知。" };

export interface SendTestPushResult {
  sent: number;
  failed: number;
}

/**
 * Use case: send the fixed test message to every subscription the user has registered.
 * A subscription the sender reports `expired` is deleted (and counts as failed);
 * a merely `failed` one is left in place (D2 in design.md).
 */
export async function sendTestPush(
  repository: PushSubscriptionRepository,
  sender: PushSender,
  userId: string,
): Promise<SendTestPushResult> {
  const subscriptions = await repository.listByUser(userId);

  let sent = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const result = await sender.send(subscription, TEST_MESSAGE);
    if (result === "sent") {
      sent++;
    } else {
      failed++;
      if (result === "expired") {
        await repository.deleteByEndpoint(userId, subscription.endpoint);
      }
    }
  }
  return { sent, failed };
}
