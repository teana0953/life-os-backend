import { describe, expect, it } from "vitest";
import { PushBudgetAlertNotifier } from "../../../../src/contexts/finance/adapters/push-budget-alert-notifier";
import type { PushSubscription, PushSubscriptionKeys, PushSubscriptionRepository } from "../../../../src/contexts/notifications/domain/push-subscription";
import { createWebPushProbe } from "../../../helpers/web-push-probe";

function repositoryWith(subscription: PushSubscription): PushSubscriptionRepository {
  return {
    upsert: async (s: PushSubscriptionKeys) => ({ id: "sub-1", ...s }),
    listByUser: async () => [subscription],
    deleteByEndpoint: async () => {},
  };
}

const MESSAGE = { title: "預算警示", body: "餐飲已用 90%" };

describe("PushBudgetAlertNotifier: what reaches the push service", () => {
  it("holds a budget alert for a day, not for the reminder TTL", async () => {
    // A budget is month-shaped: same-day arrival is still actionable, and this
    // notifier must not inherit whatever TTL the medication path happens to use.
    const probe = await createWebPushProbe();
    const notifier = new PushBudgetAlertNotifier(repositoryWith(probe.subscription), probe.sender);

    await notifier.notify("user-1", MESSAGE);

    expect(new Headers(probe.requests[0].headers).get("TTL")).toBe("86400");
  });

  it("sends no Urgency at all for a budget alert", async () => {
    // RFC8030 5.3's `high` is about what a nearly-dead device should still
    // wake for. A spending alert has no claim to that, and an absent header is
    // not the same wire message as `Urgency: normal`.
    const probe = await createWebPushProbe();
    const notifier = new PushBudgetAlertNotifier(repositoryWith(probe.subscription), probe.sender);

    await notifier.notify("user-1", MESSAGE);

    expect(new Headers(probe.requests[0].headers).has("Urgency")).toBe(false);
  });
});
