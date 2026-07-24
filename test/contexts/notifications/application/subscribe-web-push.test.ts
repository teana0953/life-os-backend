import { beforeEach, describe, expect, it } from "vitest";
import { subscribeWebPush } from "../../../../src/contexts/notifications/application/subscribe-web-push";
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

  size(): number {
    return this.byEndpoint.size;
  }
}

let repo: InMemoryPushSubscriptionRepository;

beforeEach(() => {
  repo = new InMemoryPushSubscriptionRepository();
});

describe("subscribeWebPush", () => {
  it("stores a new subscription for the user", async () => {
    const stored = await subscribeWebPush(repo, {
      userId: "user-1",
      endpoint: "https://push.example.com/abc",
      p256dh: "p256dh-key",
      auth: "auth-key",
    });

    expect(stored).toEqual({
      userId: "user-1",
      endpoint: "https://push.example.com/abc",
      p256dh: "p256dh-key",
      auth: "auth-key",
    });
    expect(await repo.listByUser("user-1")).toEqual([stored]);
  });

  it("re-subscribing the same endpoint upserts (no duplicate, keys/userId updated)", async () => {
    await subscribeWebPush(repo, {
      userId: "user-1",
      endpoint: "https://push.example.com/abc",
      p256dh: "old-key",
      auth: "old-auth",
    });

    await subscribeWebPush(repo, {
      userId: "user-2",
      endpoint: "https://push.example.com/abc",
      p256dh: "new-key",
      auth: "new-auth",
    });

    expect(await repo.listByUser("user-1")).toEqual([]);
    expect(await repo.listByUser("user-2")).toEqual([
      { userId: "user-2", endpoint: "https://push.example.com/abc", p256dh: "new-key", auth: "new-auth" },
    ]);
    expect(repo.size()).toBe(1);
  });
});
