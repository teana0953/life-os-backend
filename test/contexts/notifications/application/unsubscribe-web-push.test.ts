import { beforeEach, describe, expect, it } from "vitest";
import { subscribeWebPush } from "../../../../src/contexts/notifications/application/subscribe-web-push";
import { unsubscribeWebPush } from "../../../../src/contexts/notifications/application/unsubscribe-web-push";
import type { PushSubscription, PushSubscriptionRepository, PushSubscriptionKeys } from "../../../../src/contexts/notifications/domain/push-subscription";

class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private byEndpoint = new Map<string, PushSubscription>();

  async upsert(subscription: PushSubscriptionKeys): Promise<PushSubscription> {
    // The real repository upserts on `endpoint` and leaves the existing row's
    // `id` alone, so a re-subscribe from the same device keeps its identity.
    // Reusing a stored id here reproduces that; minting a fresh one every time
    // would make `push_delivery` rows look like they came from new devices.
    const stored = { id: this.byEndpoint.get(subscription.endpoint)?.id ?? `sub-${this.byEndpoint.size + 1}`, ...subscription };
    this.byEndpoint.set(subscription.endpoint, stored);
    return stored;
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    return [...this.byEndpoint.values()].filter((s) => s.userId === userId);
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    const existing = this.byEndpoint.get(endpoint);
    if (existing && existing.userId === userId) this.byEndpoint.delete(endpoint);
  }
}

let repo: InMemoryPushSubscriptionRepository;

beforeEach(() => {
  repo = new InMemoryPushSubscriptionRepository();
});

describe("unsubscribeWebPush", () => {
  it("removes the subscription by endpoint", async () => {
    await subscribeWebPush(repo, {
      userId: "user-1",
      endpoint: "https://push.example.com/abc",
      p256dh: "key",
      auth: "auth",
    });

    await unsubscribeWebPush(repo, "user-1", "https://push.example.com/abc");

    expect(await repo.listByUser("user-1")).toEqual([]);
  });

  it("removing a non-existent endpoint is a silent no-op", async () => {
    await expect(unsubscribeWebPush(repo, "user-1", "https://push.example.com/does-not-exist")).resolves.toBeUndefined();
  });
});
