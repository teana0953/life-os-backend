import { beforeEach, describe, expect, it } from "vitest";
import { sendTestPush } from "../../../../src/contexts/notifications/application/send-test-push";
import { subscribeWebPush } from "../../../../src/contexts/notifications/application/subscribe-web-push";
import type { PushMessage, PushSendResult, PushSender } from "../../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository } from "../../../../src/contexts/notifications/domain/push-subscription";

class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private byEndpoint = new Map<string, PushSubscription>();

  async upsert(subscription: PushSubscription): Promise<PushSubscription> {
    this.byEndpoint.set(subscription.endpoint, subscription);
    return subscription;
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    return [...this.byEndpoint.values()].filter((s) => s.userId === userId);
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    const existing = this.byEndpoint.get(endpoint);
    if (existing && existing.userId === userId) this.byEndpoint.delete(endpoint);
  }
}

/** Scriptable fake: returns results from `resultByEndpoint`, defaulting to "sent". */
class ScriptedPushSender implements PushSender {
  resultByEndpoint = new Map<string, PushSendResult>();
  sentTo: string[] = [];

  async send(subscription: PushSubscription, _message: PushMessage): Promise<PushSendResult> {
    this.sentTo.push(subscription.endpoint);
    return this.resultByEndpoint.get(subscription.endpoint) ?? "sent";
  }
}

let repo: InMemoryPushSubscriptionRepository;
let sender: ScriptedPushSender;

beforeEach(() => {
  repo = new InMemoryPushSubscriptionRepository();
  sender = new ScriptedPushSender();
});

describe("sendTestPush", () => {
  it("sends to every subscription of the user and reports sent/failed counts", async () => {
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/b", p256dh: "k", auth: "a" });

    const result = await sendTestPush(repo, sender, "user-1");

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(sender.sentTo.sort()).toEqual(["https://push.example.com/a", "https://push.example.com/b"]);
  });

  it("deletes a subscription the sender reports expired, and counts it as failed", async () => {
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/gone", p256dh: "k", auth: "a" });
    sender.resultByEndpoint.set("https://push.example.com/gone", "expired");

    const result = await sendTestPush(repo, sender, "user-1");

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(await repo.listByUser("user-1")).toEqual([]);
  });

  it("keeps a subscription that merely failed transiently", async () => {
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/flaky", p256dh: "k", auth: "a" });
    sender.resultByEndpoint.set("https://push.example.com/flaky", "failed");

    const result = await sendTestPush(repo, sender, "user-1");

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(await repo.listByUser("user-1")).toHaveLength(1);
  });

  it("returns zero counts when the user has no subscriptions", async () => {
    const result = await sendTestPush(repo, sender, "user-1");

    expect(result).toEqual({ sent: 0, failed: 0 });
  });
});
