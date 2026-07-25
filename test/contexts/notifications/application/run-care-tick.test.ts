import { beforeEach, describe, expect, it } from "vitest";
import { runCareTick } from "../../../../src/contexts/notifications/application/run-care-tick";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareCategory,
  CareItem,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
} from "../../../../src/contexts/notifications/domain/care-item";
import type { CareLog, CareLogRepository, CareLogStatus, CreateCareLogInput } from "../../../../src/contexts/notifications/domain/care-log";
import type { CareOccurrence, CareOccurrenceRepository, CreateCareOccurrenceInput } from "../../../../src/contexts/notifications/domain/care-occurrence";
import type { PushMessage, PushSendResult, PushSender } from "../../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository } from "../../../../src/contexts/notifications/domain/push-subscription";

class InMemoryCareItemRepository implements CareItemRepository {
  entries: ActiveCareSchedule[] = [];

  add(item: Partial<CareItem> & Pick<CareItem, "id" | "userId">, schedule: Partial<CareSchedule> & Pick<CareSchedule, "id">, timezone: string): void {
    const fullItem: CareItem = {
      category: "medication",
      title: "藥物",
      note: null,
      dose: null,
      stock: null,
      stockAlert: null,
      ...item,
    };
    const fullSchedule: CareSchedule = {
      careItemId: fullItem.id,
      timeOfDay: "09:00",
      repeatDays: [],
      weekInterval: 1,
      startDate: "2026-07-01",
      endDate: null,
      doseQuantity: 1,
      nagIntervalMinutes: 0,
      enabled: true,
      ...schedule,
    };
    this.entries.push({ item: fullItem, schedule: fullSchedule, timezone });
  }

  async create(): Promise<CareItemWithSchedules> {
    throw new Error("not used by these tests");
  }
  async listByUser(): Promise<CareItemWithSchedules[]> {
    throw new Error("not used by these tests");
  }
  async get(): Promise<CareItemWithSchedules | null> {
    throw new Error("not used by these tests");
  }
  async getByScheduleId(): Promise<CareItemWithSchedules | null> {
    throw new Error("not used by these tests");
  }
  async update(): Promise<CareItemWithSchedules | null> {
    throw new Error("not used by these tests");
  }
  async delete(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
  async decrementStock(): Promise<void> {
    throw new Error("not used by these tests");
  }
  async incrementStock(): Promise<void> {
    throw new Error("not used by these tests");
  }

  /** Mirrors the real repository's `WHERE enabled = true`. */
  async listActiveSchedules(): Promise<ActiveCareSchedule[]> {
    return this.entries.filter((e) => e.schedule.enabled);
  }

  async listActiveSchedulesForUserOn(): Promise<ActiveScheduleForUser[]> {
    throw new Error("not used by these tests");
  }
}

class InMemoryCareLogRepository implements CareLogRepository {
  private bySlot = new Map<string, CareLog>();
  private nextId = 1;

  private key(scheduleId: string, localDate: string, timeOfDay: string): string {
    return `${scheduleId}|${localDate}|${timeOfDay}`;
  }

  async upsertIfAbsent(input: CreateCareLogInput): Promise<{ log: CareLog; created: boolean }> {
    const key = this.key(input.careScheduleId, input.localDate, input.timeOfDay);
    const existing = this.bySlot.get(key);
    if (existing) return { log: existing, created: false };
    const log: CareLog = {
      id: `log-${this.nextId++}`,
      userId: input.userId,
      careItemId: input.careItemId,
      careScheduleId: input.careScheduleId,
      localDate: input.localDate,
      timeOfDay: input.timeOfDay,
      status: input.status,
      doneTime: input.doneTime,
      doseQuantity: input.doseQuantity,
    };
    this.bySlot.set(key, log);
    return { log, created: true };
  }

  async getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareLog | null> {
    return this.bySlot.get(this.key(careScheduleId, localDate, timeOfDay)) ?? null;
  }

  async listByUserAndDate(): Promise<CareLog[]> {
    throw new Error("not used by these tests");
  }
  async listByUserAndDateRange(): Promise<CareLog[]> {
    throw new Error("not used by these tests");
  }
  async upsert(): Promise<{ log: CareLog; previousStatus: CareLogStatus | null }> {
    throw new Error("not used by these tests");
  }

  /** Test helper: seed a log directly (simulating a prior HTTP answer), bypassing insert-if-absent. */
  seed(input: CreateCareLogInput): void {
    const key = this.key(input.careScheduleId, input.localDate, input.timeOfDay);
    this.bySlot.set(key, {
      id: `log-${this.nextId++}`,
      userId: input.userId,
      careItemId: input.careItemId,
      careScheduleId: input.careScheduleId,
      localDate: input.localDate,
      timeOfDay: input.timeOfDay,
      status: input.status,
      doneTime: input.doneTime,
      doseQuantity: input.doseQuantity,
    });
  }

  all(): CareLog[] {
    return [...this.bySlot.values()];
  }

  statusOf(scheduleId: string, localDate: string, timeOfDay: string): CareLogStatus | undefined {
    return this.bySlot.get(this.key(scheduleId, localDate, timeOfDay))?.status;
  }
}

class InMemoryCareOccurrenceRepository implements CareOccurrenceRepository {
  private bySlot = new Map<string, CareOccurrence>();
  private nextId = 1;

  /** Mirrors the real repository's LEFT JOIN care_log for `listPastUnlogged`. */
  constructor(private readonly careLogRepo: InMemoryCareLogRepository) {}

  private key(scheduleId: string, localDate: string, timeOfDay: string): string {
    return `${scheduleId}|${localDate}|${timeOfDay}`;
  }

  async upsertBySlot(input: CreateCareOccurrenceInput): Promise<CareOccurrence> {
    const key = this.key(input.careScheduleId, input.localDate, input.timeOfDay);
    const existing = this.bySlot.get(key);
    if (existing) return existing;
    const occurrence: CareOccurrence = {
      id: `occ-${this.nextId++}`,
      userId: input.userId,
      careItemId: input.careItemId,
      careScheduleId: input.careScheduleId,
      localDate: input.localDate,
      timeOfDay: input.timeOfDay,
      lastNotifiedAt: null,
    };
    this.bySlot.set(key, occurrence);
    return occurrence;
  }

  async getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareOccurrence | null> {
    return this.bySlot.get(this.key(careScheduleId, localDate, timeOfDay)) ?? null;
  }

  async touchNotified(id: string, at: Date): Promise<void> {
    for (const occ of this.bySlot.values()) {
      if (occ.id === id) {
        occ.lastNotifiedAt = at;
        return;
      }
    }
  }

  async listPastUnlogged(careScheduleId: string, todayLocalDate: string): Promise<CareOccurrence[]> {
    const past = [...this.bySlot.values()].filter((o) => o.careScheduleId === careScheduleId && o.localDate < todayLocalDate);
    const unlogged: CareOccurrence[] = [];
    for (const o of past) {
      const log = await this.careLogRepo.getBySlot(o.careScheduleId, o.localDate, o.timeOfDay);
      if (!log) unlogged.push(o);
    }
    return unlogged;
  }

  all(): CareOccurrence[] {
    return [...this.bySlot.values()];
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

let careItemRepo: InMemoryCareItemRepository;
let careLogRepo: InMemoryCareLogRepository;
let careOccurrenceRepo: InMemoryCareOccurrenceRepository;
let subscriptionRepo: InMemoryPushSubscriptionRepository;
let pushSender: ScriptedPushSender;

function deps() {
  return { careItemRepo, careLogRepo, careOccurrenceRepo, subscriptionRepo, pushSender };
}

beforeEach(() => {
  careItemRepo = new InMemoryCareItemRepository();
  careLogRepo = new InMemoryCareLogRepository();
  careOccurrenceRepo = new InMemoryCareOccurrenceRepository(careLogRepo);
  subscriptionRepo = new InMemoryPushSubscriptionRepository();
  pushSender = new ScriptedPushSender();
});

// 2026-07-24 is a Friday (weekday 5); Taipei is UTC+8 (no DST).
const FRIDAY_0900_TAIPEI = new Date("2026-07-24T01:00:00Z"); // 2026-07-24 09:00 Asia/Taipei

async function addSubscription(userId: string, endpoint = `https://push.example.com/${userId}`) {
  await subscriptionRepo.upsert({ userId, endpoint, p256dh: "k", auth: "a" });
  return endpoint;
}

describe("runCareTick", () => {
  it("materializes an occurrence and dispatches a push for a current-minute match", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    const endpoint = await addSubscription("user-1");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    const occurrences = careOccurrenceRepo.all();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ careScheduleId: "sched-1", localDate: "2026-07-24", timeOfDay: "09:00" });
    expect(occurrences[0].lastNotifiedAt).toEqual(FRIDAY_0900_TAIPEI);
    expect(pushSender.sentTo).toEqual([endpoint]);
    expect(careLogRepo.all()).toHaveLength(0);
  });

  it("fires on every day when repeat_days is empty", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] }, "Asia/Taipei");
    await addSubscription("user-1");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(1);
  });

  it("fires nothing on an inactive weekday", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [1] }, "Asia/Taipei"); // Monday only

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing when the every-N-weeks interval is off for this week", async () => {
    // start_date 2026-07-01 -> 2026-07-24 is week 3 (weeksSince=3); interval 2 -> 3 % 2 !== 0.
    careItemRepo.add(
      { id: "item-1", userId: "user-1" },
      { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], weekInterval: 2, startDate: "2026-07-01" },
      "Asia/Taipei",
    );

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing before start_date or after end_date", async () => {
    careItemRepo.add(
      { id: "item-1", userId: "user-1" },
      { id: "sched-future", timeOfDay: "09:00", repeatDays: [5], startDate: "2026-08-01" },
      "Asia/Taipei",
    );
    careItemRepo.add(
      { id: "item-2", userId: "user-2" },
      { id: "sched-ended", timeOfDay: "09:00", repeatDays: [5], startDate: "2026-07-01", endDate: "2026-07-10" },
      "Asia/Taipei",
    );

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing for a disabled schedule", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], enabled: false }, "Asia/Taipei");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
  });

  it("does not double-send when the tick runs twice for the same slot", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    await addSubscription("user-1");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());
    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(1);
    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("nag_interval_minutes = 0 fires exactly once: a later same-day tick does NOT re-send", async () => {
    careItemRepo.add(
      { id: "item-1", userId: "user-1" },
      { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 0 },
      "Asia/Taipei",
    );
    await addSubscription("user-1");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());
    // An hour later, same local day — well past any "elapsed" window, but interval=0 must not re-nag.
    const anHourLater = new Date(FRIDAY_0900_TAIPEI.getTime() + 60 * 60_000);
    await runCareTick(anHourLater, deps());

    expect(pushSender.sentTo).toHaveLength(1);
    expect(careOccurrenceRepo.all()).toHaveLength(1);
  });

  it("re-nags after nag_interval_minutes elapses, and not before", async () => {
    careItemRepo.add(
      { id: "item-1", userId: "user-1" },
      { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 10 },
      "Asia/Taipei",
    );
    await addSubscription("user-1");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    // +5 minutes: not yet elapsed.
    await runCareTick(new Date(FRIDAY_0900_TAIPEI.getTime() + 5 * 60_000), deps());
    expect(pushSender.sentTo).toHaveLength(1);

    // +10 minutes: elapsed, re-nags.
    await runCareTick(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), deps());
    expect(pushSender.sentTo).toHaveLength(2);
  });

  it("a care_log stops the nag", async () => {
    careItemRepo.add(
      { id: "item-1", userId: "user-1" },
      { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 5 },
      "Asia/Taipei",
    );
    await addSubscription("user-1");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      status: "done",
      doneTime: FRIDAY_0900_TAIPEI,
      doseQuantity: 1,
    });

    await runCareTick(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), deps());

    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("a late tick still delivers a just-missed time once, within a 5-minute look-back", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    await addSubscription("user-1");
    const fourMinutesLate = new Date(FRIDAY_0900_TAIPEI.getTime() + 4 * 60_000); // 09:04 Taipei

    await runCareTick(fourMinutesLate, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(1);
    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("a slot unanswered before midnight is marked missed the next day, and is not delivered again across midnight", async () => {
    // Friday-only schedule at 23:58; a tick just before midnight fires it once.
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "23:58", repeatDays: [5] }, "Asia/Taipei");
    await addSubscription("user-1");
    const fridayJustBeforeMidnight = new Date("2026-07-24T15:59:00Z"); // 2026-07-24 23:59 Asia/Taipei
    const saturdayJustAfterMidnight = new Date("2026-07-24T16:05:00Z"); // 2026-07-25 00:05 Asia/Taipei

    await runCareTick(fridayJustBeforeMidnight, deps());
    expect(pushSender.sentTo).toHaveLength(1);
    expect(careOccurrenceRepo.all()).toHaveLength(1);
    expect(careLogRepo.all()).toHaveLength(0);

    await runCareTick(saturdayJustAfterMidnight, deps());

    // No re-delivery across midnight (schedule is Friday-only, so it also
    // doesn't fire fresh on Saturday) — the push count stays at 1.
    expect(pushSender.sentTo).toHaveLength(1);
    // The stale Friday slot is now recorded missed.
    expect(careLogRepo.statusOf("sched-1", "2026-07-24", "23:58")).toBe("missed");
    // No new occurrence was created for Saturday.
    expect(careOccurrenceRepo.all()).toHaveLength(1);
  });

  it("markMissed's insert-if-absent leaves an existing done/skipped log intact", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "23:58", repeatDays: [5] }, "Asia/Taipei");
    await addSubscription("user-1");
    const fridayJustBeforeMidnight = new Date("2026-07-24T15:59:00Z");
    const saturdayJustAfterMidnight = new Date("2026-07-24T16:05:00Z");

    await runCareTick(fridayJustBeforeMidnight, deps());
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "23:58",
      status: "done",
      doneTime: fridayJustBeforeMidnight,
      doseQuantity: 1,
    });

    await runCareTick(saturdayJustAfterMidnight, deps());

    expect(careLogRepo.statusOf("sched-1", "2026-07-24", "23:58")).toBe("done");
  });

  it("marks nothing missed while the slot is still on today's local date", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    await addSubscription("user-1");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());
    await runCareTick(new Date(FRIDAY_0900_TAIPEI.getTime() + 30 * 60_000), deps());

    expect(careLogRepo.all()).toHaveLength(0);
  });

  it("isolates a failing schedule so other schedules still dispatch", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    careItemRepo.add({ id: "item-2", userId: "user-2" }, { id: "sched-2", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    await addSubscription("user-2");

    const throwingSubs: PushSubscriptionRepository = {
      upsert: subscriptionRepo.upsert.bind(subscriptionRepo),
      deleteByEndpoint: subscriptionRepo.deleteByEndpoint.bind(subscriptionRepo),
      listByUser: async (userId: string) => {
        if (userId === "user-1") throw new Error("db down");
        return subscriptionRepo.listByUser(userId);
      },
    };

    await runCareTick(FRIDAY_0900_TAIPEI, { ...deps(), subscriptionRepo: throwingSubs });

    // The tick did not throw; user-2 still received their reminder.
    expect(pushSender.sentTo).toEqual(["https://push.example.com/user-2"]);
  });

  it("respects each schedule's own user's timezone independently", async () => {
    // Taipei (UTC+8): 2026-07-24T01:00:00Z is 09:00 local. New York (UTC-4 in
    // July, DST): the same instant is 21:00 the previous day local, not 09:00 —
    // so only the Taipei-user schedule should fire.
    careItemRepo.add({ id: "item-taipei", userId: "user-taipei" }, { id: "sched-taipei", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    careItemRepo.add(
      { id: "item-ny", userId: "user-ny" },
      { id: "sched-ny", timeOfDay: "09:00", repeatDays: [0, 1, 2, 3, 4, 5, 6] },
      "America/New_York",
    );
    await addSubscription("user-taipei");
    await addSubscription("user-ny");

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    const occurrences = careOccurrenceRepo.all();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].userId).toBe("user-taipei");
    expect(pushSender.sentTo).toEqual(["https://push.example.com/user-taipei"]);
  });

  it("prunes a subscription the sender reports expired", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    const endpoint = await addSubscription("user-1", "https://push.example.com/gone");
    pushSender.resultByEndpoint.set(endpoint, { outcome: "expired", detail: "status_410" });

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    expect(await subscriptionRepo.listByUser("user-1")).toEqual([]);
  });

  it("uses the medication dose as the push body when set, else the note", async () => {
    careItemRepo.add(
      { id: "item-1", userId: "user-1", category: "medication" as CareCategory, dose: "5mg", note: null },
      { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] },
      "Asia/Taipei",
    );
    careItemRepo.add(
      { id: "item-2", userId: "user-2", category: "rehab" as CareCategory, dose: null, note: "伸展 15 分鐘" },
      { id: "sched-2", timeOfDay: "09:00", repeatDays: [5] },
      "Asia/Taipei",
    );
    await addSubscription("user-1");
    await addSubscription("user-2");

    const bodies: string[] = [];
    const recordingSender: PushSender = {
      send: async (_sub, message) => {
        bodies.push(message.body);
        return { outcome: "sent" };
      },
    };

    await runCareTick(FRIDAY_0900_TAIPEI, { ...deps(), pushSender: recordingSender });

    expect(bodies.sort()).toEqual(["5mg", "伸展 15 分鐘"]);
  });

  it("markMissed excludes an already-logged past slot and marks an unlogged one missed exactly once", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] }, "Asia/Taipei");
    await addSubscription("user-1");

    // Two past occurrences, seeded directly to isolate markMissed from dispatch.
    await careOccurrenceRepo.upsertBySlot({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-22",
      timeOfDay: "09:00",
    });
    await careOccurrenceRepo.upsertBySlot({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-23",
      timeOfDay: "09:00",
    });
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-22",
      timeOfDay: "09:00",
      status: "done",
      doneTime: new Date("2026-07-22T01:00:00Z"),
      doseQuantity: 1,
    });

    // The already-logged 07-22 slot is not returned for missing-marking; the unlogged 07-23 one is.
    const unlogged = await careOccurrenceRepo.listPastUnlogged("sched-1", "2026-07-24");
    expect(unlogged.map((o) => o.localDate)).toEqual(["2026-07-23"]);

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    expect(careLogRepo.statusOf("sched-1", "2026-07-22", "09:00")).toBe("done"); // untouched
    expect(careLogRepo.statusOf("sched-1", "2026-07-23", "09:00")).toBe("missed"); // newly marked, exactly once

    // A second tick re-derives the same (now-empty) unlogged set — no re-scan of the logged slots.
    await runCareTick(new Date(FRIDAY_0900_TAIPEI.getTime() + 60_000), deps());
    expect(await careOccurrenceRepo.listPastUnlogged("sched-1", "2026-07-24")).toEqual([]);
  });

  it("does not mark an occurrence notified when the user has no subscription (so it fires once one is added)", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] }, "Asia/Taipei");
    // No subscription added.

    await runCareTick(FRIDAY_0900_TAIPEI, deps());

    const occurrences = careOccurrenceRepo.all();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].lastNotifiedAt).toBeNull();
    expect(pushSender.sentTo).toHaveLength(0);

    // A subscription is added; a later same-day tick still fires since lastNotifiedAt stayed null.
    const endpoint = await addSubscription("user-1");
    await runCareTick(new Date(FRIDAY_0900_TAIPEI.getTime() + 60_000), deps());

    expect(pushSender.sentTo).toEqual([endpoint]);
  });
});
