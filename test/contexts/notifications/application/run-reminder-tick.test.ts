import { beforeEach, describe, expect, it } from "vitest";
import { runReminderTick } from "../../../../src/contexts/notifications/application/run-reminder-tick";
import type {
  PushMessage,
  PushSendResult,
  PushSender,
} from "../../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository } from "../../../../src/contexts/notifications/domain/push-subscription";
import type {
  CreateReminderOccurrenceInput,
  ReminderOccurrence,
  ReminderOccurrenceRepository,
  ReminderOccurrenceStatus,
} from "../../../../src/contexts/notifications/domain/reminder-occurrence";
import type {
  ActiveReminderSchedule,
  CreateReminderScheduleInput,
  ReminderSchedule,
  ReminderScheduleRepository,
  UpdateReminderSchedulePatch,
} from "../../../../src/contexts/notifications/domain/reminder-schedule";

class InMemoryReminderScheduleRepository implements ReminderScheduleRepository {
  entries: ActiveReminderSchedule[] = [];

  add(schedule: Partial<ReminderSchedule> & Pick<ReminderSchedule, "id" | "userId">, timezone: string): ReminderSchedule {
    const full: ReminderSchedule = {
      category: "medication",
      label: "藥物",
      times: [],
      daysOfWeek: [],
      weekInterval: 1,
      anchorDate: "2026-01-01",
      enabled: true,
      ...schedule,
    };
    this.entries.push({ schedule: full, timezone });
    return full;
  }

  async create(_input: CreateReminderScheduleInput): Promise<ReminderSchedule> {
    throw new Error("not used by these tests");
  }
  async listByUser(_userId: string): Promise<ReminderSchedule[]> {
    throw new Error("not used by these tests");
  }
  async get(_id: string): Promise<ReminderSchedule | null> {
    throw new Error("not used by these tests");
  }
  async update(_id: string, _userId: string, _patch: UpdateReminderSchedulePatch): Promise<ReminderSchedule | null> {
    throw new Error("not used by these tests");
  }
  async delete(_id: string, _userId: string): Promise<boolean> {
    throw new Error("not used by these tests");
  }

  /** Mirrors the real repository's `WHERE enabled = true`. */
  async listActiveAll(): Promise<ActiveReminderSchedule[]> {
    return this.entries.filter((e) => e.schedule.enabled);
  }
}

class InMemoryReminderOccurrenceRepository implements ReminderOccurrenceRepository {
  private byDedupeKey = new Map<string, ReminderOccurrence>();
  private nextId = 1;

  async upsertByDedupeKey(input: CreateReminderOccurrenceInput): Promise<ReminderOccurrence> {
    const existing = this.byDedupeKey.get(input.dedupeKey);
    if (existing) return existing;
    const occurrence: ReminderOccurrence = {
      id: `occ-${this.nextId++}`,
      userId: input.userId,
      kind: input.kind,
      dueAt: input.dueAt,
      title: input.title,
      body: input.body,
      status: "pending",
      dedupeKey: input.dedupeKey,
    };
    this.byDedupeKey.set(input.dedupeKey, occurrence);
    return occurrence;
  }

  async listDuePending(now: Date): Promise<ReminderOccurrence[]> {
    return [...this.byDedupeKey.values()].filter((o) => o.status === "pending" && o.dueAt.getTime() <= now.getTime());
  }

  private setStatus(id: string, status: ReminderOccurrenceStatus): void {
    for (const occ of this.byDedupeKey.values()) {
      if (occ.id === id) {
        occ.status = status;
        return;
      }
    }
  }

  async markSent(id: string): Promise<void> {
    this.setStatus(id, "sent");
  }
  async markSkipped(id: string): Promise<void> {
    this.setStatus(id, "skipped");
  }
  async markFailed(id: string): Promise<void> {
    this.setStatus(id, "failed");
  }

  all(): ReminderOccurrence[] {
    return [...this.byDedupeKey.values()];
  }
}

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
    return this.resultByEndpoint.get(subscription.endpoint) ?? { outcome: "sent" };
  }
}

let scheduleRepo: InMemoryReminderScheduleRepository;
let occurrenceRepo: InMemoryReminderOccurrenceRepository;
let subscriptionRepo: InMemoryPushSubscriptionRepository;
let pushSender: ScriptedPushSender;

function deps() {
  return { scheduleRepo, occurrenceRepo, subscriptionRepo, pushSender };
}

beforeEach(() => {
  scheduleRepo = new InMemoryReminderScheduleRepository();
  occurrenceRepo = new InMemoryReminderOccurrenceRepository();
  subscriptionRepo = new InMemoryPushSubscriptionRepository();
  pushSender = new ScriptedPushSender();
});

// 2026-07-24 is a Friday (weekday 5); Taipei is UTC+8 (no DST).
const FRIDAY_0900_TAIPEI = new Date("2026-07-24T01:00:00Z"); // 2026-07-24 09:00 Asia/Taipei

describe("runReminderTick", () => {
  it("materializes and dispatches exactly one occurrence for a current-minute match", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    await subscriptionRepo.upsert({ userId: "user-1", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    const occurrences = occurrenceRepo.all();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ status: "sent", dedupeKey: "sched-1|2026-07-24|09:00" });
    expect(pushSender.sentTo).toEqual(["https://push.example.com/a"]);
  });

  it("isolates a failing occurrence so the rest of the tick still dispatches", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    scheduleRepo.add(
      { id: "sched-2", userId: "user-2", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    await subscriptionRepo.upsert({ userId: "user-2", endpoint: "https://push.example.com/b", p256dh: "k", auth: "a" });

    // A DB error while dispatching user-1's occurrence must not abort the tick.
    const throwingSubs: PushSubscriptionRepository = {
      upsert: subscriptionRepo.upsert.bind(subscriptionRepo),
      deleteByEndpoint: subscriptionRepo.deleteByEndpoint.bind(subscriptionRepo),
      listByUser: async (userId: string) => {
        if (userId === "user-1") throw new Error("db down");
        return subscriptionRepo.listByUser(userId);
      },
    };

    await runReminderTick(FRIDAY_0900_TAIPEI, { scheduleRepo, occurrenceRepo, subscriptionRepo: throwingSubs, pushSender });

    // The tick did not throw; user-2 still received their reminder; user-1's
    // occurrence is marked terminal (failed), not left pending to re-send.
    expect(pushSender.sentTo).toEqual(["https://push.example.com/b"]);
    const byUser = Object.fromEntries(occurrenceRepo.all().map((o) => [o.userId, o.status]));
    expect(byUser["user-2"]).toBe("sent");
    expect(byUser["user-1"]).toBe("failed");
  });

  it("does not double-send when the tick runs twice for the same schedule/day/time", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    await subscriptionRepo.upsert({ userId: "user-1", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());
    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    expect(occurrenceRepo.all()).toHaveLength(1);
    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("fires nothing on an inactive weekday", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [1], anchorDate: "2026-07-01" }, // Monday only
      "Asia/Taipei",
    );

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    expect(occurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing when the every-N-weeks interval is off for this week", async () => {
    // anchor 2026-07-01 -> 2026-07-24 is week 3 (weeksSince=3); interval 2 -> 3 % 2 !== 0.
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], weekInterval: 2, anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    expect(occurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing when the anchor date is in the future", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-08-01" },
      "Asia/Taipei",
    );

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    expect(occurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing for a disabled schedule", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01", enabled: false },
      "Asia/Taipei",
    );

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    expect(occurrenceRepo.all()).toHaveLength(0);
  });

  it("a late tick after midnight still delivers a just-missed time once, keyed to the previous local date", async () => {
    // Schedule time 23:58 Friday (2026-07-24); the tick runs at Taipei 00:02 the
    // next day (Saturday 2026-07-25) — a 4-minute look-back recovery.
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["23:58"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    await subscriptionRepo.upsert({ userId: "user-1", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });
    const justAfterMidnight = new Date("2026-07-24T16:02:00Z"); // 2026-07-25 00:02 Asia/Taipei

    await runReminderTick(justAfterMidnight, deps());

    const occurrences = occurrenceRepo.all();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].dedupeKey).toBe("sched-1|2026-07-24|23:58");
    expect(occurrences[0].status).toBe("sent");
  });

  it("marks the occurrence skipped, and sends nothing, when the user has no subscription", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    const occurrences = occurrenceRepo.all();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].status).toBe("skipped");
    expect(pushSender.sentTo).toHaveLength(0);
  });

  it("marks the occurrence failed (not sent) when every send fails", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    await subscriptionRepo.upsert({ userId: "user-1", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });
    await subscriptionRepo.upsert({ userId: "user-1", endpoint: "https://push.example.com/b", p256dh: "k", auth: "a" });
    pushSender.resultByEndpoint.set("https://push.example.com/a", { outcome: "failed", detail: "status_500" });
    pushSender.resultByEndpoint.set("https://push.example.com/b", { outcome: "failed", detail: "status_500" });

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    expect(occurrenceRepo.all()[0].status).toBe("failed");
  });

  it("marks the occurrence sent when at least one send succeeds", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    await subscriptionRepo.upsert({ userId: "user-1", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });
    await subscriptionRepo.upsert({ userId: "user-1", endpoint: "https://push.example.com/b", p256dh: "k", auth: "a" });
    pushSender.resultByEndpoint.set("https://push.example.com/a", { outcome: "failed", detail: "status_500" });
    pushSender.resultByEndpoint.set("https://push.example.com/b", { outcome: "sent" });

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    expect(occurrenceRepo.all()[0].status).toBe("sent");
  });

  it("deletes a subscription the sender reports expired, and does not count it toward sent", async () => {
    scheduleRepo.add(
      { id: "sched-1", userId: "user-1", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    await subscriptionRepo.upsert({ userId: "user-1", endpoint: "https://push.example.com/gone", p256dh: "k", auth: "a" });
    pushSender.resultByEndpoint.set("https://push.example.com/gone", { outcome: "expired", detail: "status_410" });

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    expect(await subscriptionRepo.listByUser("user-1")).toEqual([]);
    expect(occurrenceRepo.all()[0].status).toBe("failed");
  });

  it("respects each schedule's own user's timezone independently", async () => {
    // Taipei (UTC+8): 2026-07-24T01:00:00Z is 09:00 local. New York (UTC-4 in
    // July, DST): the same instant is 21:00 the previous day local, not 09:00 —
    // so only the Taipei-user schedule should fire.
    scheduleRepo.add(
      { id: "sched-taipei", userId: "user-taipei", times: ["09:00"], daysOfWeek: [5], anchorDate: "2026-07-01" },
      "Asia/Taipei",
    );
    scheduleRepo.add(
      { id: "sched-ny", userId: "user-ny", times: ["09:00"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], anchorDate: "2026-07-01" },
      "America/New_York",
    );
    await subscriptionRepo.upsert({ userId: "user-taipei", endpoint: "https://push.example.com/taipei", p256dh: "k", auth: "a" });
    await subscriptionRepo.upsert({ userId: "user-ny", endpoint: "https://push.example.com/ny", p256dh: "k", auth: "a" });

    await runReminderTick(FRIDAY_0900_TAIPEI, deps());

    const occurrences = occurrenceRepo.all();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].userId).toBe("user-taipei");
    expect(pushSender.sentTo).toEqual(["https://push.example.com/taipei"]);
  });
});
