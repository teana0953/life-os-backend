import type { PushSender } from "../../notifications/domain/push-sender";
import type { PushSubscriptionRepository } from "../../notifications/domain/push-subscription";
import type { BudgetAlertMessage, BudgetAlertNotifier } from "../domain/budget-alert-notifier";

/**
 * Driven adapter: implements finance's `BudgetAlertNotifier` port by wrapping
 * the notifications context's `PushSender`/`PushSubscriptionRepository`
 * ports (send-test-push.ts convention). This is the one place finance is
 * allowed to reach into another context — the composition root wires it, and
 * it never leaks into `finance/domain` or `finance/application` (design.md
 * cross-context boundary). `checkBudgetAlerts` already built the exact
 * `title`/`body` copy; this adapter's only job is delivery to every one of
 * the user's subscriptions, deleting any the sender reports `expired`.
 */
export class PushBudgetAlertNotifier implements BudgetAlertNotifier {
  constructor(
    private readonly subscriptionRepository: PushSubscriptionRepository,
    private readonly pushSender: PushSender,
  ) {}

  async notify(userId: string, message: BudgetAlertMessage): Promise<void> {
    const subscriptions = await this.subscriptionRepository.listByUser(userId);
    for (const subscription of subscriptions) {
      const { outcome } = await this.pushSender.send(subscription, message);
      if (outcome === "expired") {
        await this.subscriptionRepository.deleteByEndpoint(userId, subscription.endpoint);
      }
    }
  }
}
