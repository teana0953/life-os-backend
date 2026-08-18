import type { PushMessage, PushSender } from "../domain/push-sender";
import type { PushSubscriptionRepository } from "../domain/push-subscription";

/**
 * A fixed, generic test message — no personal data (per design "Privacy / security").
 *
 * `ttlSeconds` is 60 because this message means "I pressed the button, does my
 * phone light up now": a test push that arrives after the user has walked away
 * from the settings screen answers nothing. It carries no `data.ack` — there is
 * no occurrence to attribute delivery to, and `POST /api/push/test` already
 * answers synchronously with the per-subscription result.
 */
export const TEST_MESSAGE: PushMessage = {
  title: "LifeOS 測試通知",
  body: "這是一則測試推播，確認裝置能正常接收通知。",
  ttlSeconds: 60,
  urgency: "high",
};

export interface SendTestPushResult {
  sent: number;
  failed: number;
  errors: string[];
}

/**
 * Use case: send the fixed test message to every subscription the user has registered.
 * A subscription the sender reports `expired` is deleted (and counts as failed);
 * a merely `failed` one is left in place (D2 in design.md). `errors` collects each
 * non-sent send's `detail` (a short, non-credential diagnostic) for troubleshooting.
 */
export async function sendTestPush(
  repository: PushSubscriptionRepository,
  sender: PushSender,
  userId: string,
): Promise<SendTestPushResult> {
  const subscriptions = await repository.listByUser(userId);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const subscription of subscriptions) {
    const { outcome, detail } = await sender.send(subscription, TEST_MESSAGE);
    if (outcome === "sent") {
      sent++;
    } else {
      failed++;
      if (detail) errors.push(detail);
      if (outcome === "expired") {
        await repository.deleteByEndpoint(userId, subscription.endpoint);
      }
    }
  }
  return { sent, failed, errors };
}
