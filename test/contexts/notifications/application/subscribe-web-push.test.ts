import { beforeEach, describe, expect, it } from "vitest";
import { subscribeWebPush } from "../../../../src/contexts/notifications/application/subscribe-web-push";
import type { CareDayInstanceManager } from "../../../../src/contexts/notifications/domain/care-day-instance";
import type { CareChainItemRepo } from "../../../../src/contexts/notifications/application/care-day-chain";
import type { CareItemWithSchedules, CareSchedule } from "../../../../src/contexts/notifications/domain/care-item";
import type { CareOccurrenceRepository } from "../../../../src/contexts/notifications/domain/care-occurrence";
import { localParts, nextLocalDate } from "../../../../src/shared-kernel/reminder-clock";
import type { PushSubscription, PushSubscriptionRepository, PushSubscriptionKeys } from "../../../../src/contexts/notifications/domain/push-subscription";
import type { UserRepository } from "../../../../src/contexts/user/domain/user-repository";

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

  size(): number {
    return this.byEndpoint.size;
  }
}

/** `userId`'s items, as a single item carrying `schedules` — only `listByUser` is ever called. */
function chainRepo(schedules: Partial<CareSchedule>[]): CareChainItemRepo {
  const item: CareItemWithSchedules = {
    id: "item-1",
    userId: "user-1",
    category: "medication",
    title: "藥物",
    note: null,
    dose: null,
    stock: null,
    stockAlert: null,
    schedules: schedules.map((schedule, i) => ({
      id: `sched-${i}`,
      careItemId: "item-1",
      timeOfDay: "09:00",
      repeatDays: [],
      weekInterval: 1,
      startDate: "2020-01-01",
      endDate: null,
      doseQuantity: 1,
      nagIntervalMinutes: 0,
      enabled: true,
      ...schedule,
    })),
  };
  return { listByUser: async () => [item] };
}

/** `n` days after today in Taipei — the zone `restartCareDayBestEffort` falls back to. */
function daysFromToday(n: number): string {
  let date = localParts(new Date(), "Asia/Taipei").date;
  for (let i = 0; i < n; i++) date = nextLocalDate(date);
  return date;
}

/** Fires every day, forever — the ordinary "has an upcoming care day" case. */
const DAILY_FOREVER = chainRepo([{}]);

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

    expect(stored).toMatchObject({
      userId: "user-1",
      endpoint: "https://push.example.com/abc",
      p256dh: "p256dh-key",
      auth: "auth-key",
    });
    expect(await repo.listByUser("user-1")).toEqual([stored]);
  });

  it("re-subscribing the same endpoint upserts (no duplicate, keys/userId updated)", async () => {
    const stored = await subscribeWebPush(repo, {
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
    expect(await repo.listByUser("user-2")).toMatchObject([
      { userId: "user-2", endpoint: "https://push.example.com/abc", p256dh: "new-key", auth: "new-auth" },
    ]);
    // The device keeps its identity across a re-subscribe, so delivery rows
    // written before it are still attributable to the same device.
    expect((await repo.listByUser("user-2"))[0].id).toBe(stored.id);
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
      ensureFor: async () => {},
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
      { instanceManager, userRepository, careItemRepo: DAILY_FOREVER, careOccurrenceRepo },
    );

    expect(calls[0]).toMatch(/^expedite:user-1:\d{4}-\d{2}-\d{2}$/);
    expect(calls[1]).toBe("restartToday");
  });

  it("without a careOccurrenceRepo, restarts the instance but skips expediting (existing callers keep working)", async () => {
    const calls: string[] = [];
    const instanceManager: CareDayInstanceManager = {
      ensureFor: async () => {},
      restartToday: async () => {
        calls.push("restartToday");
      },
    };
    const userRepository: Pick<UserRepository, "getById"> = { getById: async () => null };

    await subscribeWebPush(
      repo,
      { userId: "user-1", endpoint: "https://push.example.com/abc", p256dh: "p256dh-key", auth: "auth-key" },
      { instanceManager, userRepository, careItemRepo: DAILY_FOREVER },
    );

    expect(calls).toEqual(["restartToday"]);
  });

  it("skips the restart (and the expedite) entirely when the subscriber has no upcoming care day at all", async () => {
    // The idle-instance-chain fix: a subscriber whose schedules have all
    // expired must not get a fresh instance created for a day with nothing
    // in it — that instance would wake at midnight only to end the chain.
    const calls: string[] = [];
    const instanceManager: CareDayInstanceManager = {
      ensureFor: async () => {},
      restartToday: async () => {
        calls.push("restartToday");
      },
    };
    const careOccurrenceRepo: Pick<CareOccurrenceRepository, "expediteNoSubscriptionsRetry"> = {
      expediteNoSubscriptionsRetry: async () => {
        calls.push("expedite");
      },
    };
    const userRepository: Pick<UserRepository, "getById"> = { getById: async () => null };

    await subscribeWebPush(
      repo,
      { userId: "user-1", endpoint: "https://push.example.com/abc", p256dh: "p256dh-key", auth: "auth-key" },
      { instanceManager, userRepository, careItemRepo: chainRepo([{ endDate: "2020-06-30" }]), careOccurrenceRepo },
    );

    expect(calls).toEqual([]);
    expect(repo.size()).toBe(1); // the subscription itself was still stored — the gate is on the restart only.
  });

  it("still restarts when today is idle but a later day is not (the gate asks about the future, not about today)", async () => {
    // Reverse guard for the test above: a gate that skipped whenever TODAY
    // has no slot would break the user whose reminders start in a few days.
    const calls: string[] = [];
    const instanceManager: CareDayInstanceManager = {
      ensureFor: async () => {},
      restartToday: async () => {
        calls.push("restartToday");
      },
    };
    const userRepository: Pick<UserRepository, "getById"> = { getById: async () => null };

    await subscribeWebPush(
      repo,
      { userId: "user-1", endpoint: "https://push.example.com/abc", p256dh: "p256dh-key", auth: "auth-key" },
      { instanceManager, userRepository, careItemRepo: chainRepo([{ startDate: daysFromToday(3) }]) },
    );

    expect(calls).toEqual(["restartToday"]);
  });
});
