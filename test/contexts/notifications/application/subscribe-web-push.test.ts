import { beforeEach, describe, expect, it } from "vitest";
import { subscribeWebPush } from "../../../../src/contexts/notifications/application/subscribe-web-push";
import type { CareDayInstanceManager } from "../../../../src/contexts/notifications/domain/care-day-instance";
import type { CareOccurrenceRepository } from "../../../../src/contexts/notifications/domain/care-occurrence";
import type { PushSubscription, PushSubscriptionRepository } from "../../../../src/contexts/notifications/domain/push-subscription";
import type { UserRepository } from "../../../../src/contexts/user/domain/user-repository";

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

  it("expedites any no_subscriptions slot for today BEFORE restarting today's instance (D12')", async () => {
    // Guards the CRITICAL gap where restartToday alone re-reads unchanged
    // occurrence rows and so does NOT actually make a no_subscriptions slot
    // due any sooner — only expediteNoSubscriptionsRetry does that. If a
    // future change drops the expedite call (or reorders it after the
    // restart), this test must go red.
    const calls: string[] = [];
    const instanceManager: CareDayInstanceManager = {
      ensureToday: async () => {},
      restartToday: async () => {
        calls.push("restartToday");
      },
    };
    const careOccurrenceRepo: Pick<CareOccurrenceRepository, "expediteNoSubscriptionsRetry"> = {
      expediteNoSubscriptionsRetry: async (userId, localDate) => {
        calls.push(`expedite:${userId}:${localDate}`);
      },
    };
    const userRepository: Pick<UserRepository, "getById"> = {
      getById: async () => ({
        id: "user-1",
        firebaseUid: "fb-1",
        email: "a@example.com",
        displayName: "A",
        timezone: "Asia/Taipei",
        isAdmin: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    };

    await subscribeWebPush(
      repo,
      { userId: "user-1", endpoint: "https://push.example.com/abc", p256dh: "p256dh-key", auth: "auth-key" },
      { instanceManager, userRepository, careOccurrenceRepo },
    );

    expect(calls[0]).toMatch(/^expedite:user-1:\d{4}-\d{2}-\d{2}$/);
    expect(calls[1]).toBe("restartToday");
  });

  it("without a careOccurrenceRepo, restarts the instance but skips expediting (existing callers keep working)", async () => {
    const calls: string[] = [];
    const instanceManager: CareDayInstanceManager = {
      ensureToday: async () => {},
      restartToday: async () => {
        calls.push("restartToday");
      },
    };
    const userRepository: Pick<UserRepository, "getById"> = { getById: async () => null };

    await subscribeWebPush(
      repo,
      { userId: "user-1", endpoint: "https://push.example.com/abc", p256dh: "p256dh-key", auth: "auth-key" },
      { instanceManager, userRepository },
    );

    expect(calls).toEqual(["restartToday"]);
  });
});
