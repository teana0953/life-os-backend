import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSlotSnapshots,
  dispatchDueRounds,
  markMissedForUserDay,
  planNextWake,
  type RunCareDayDeps,
  type SlotSnapshot,
} from "../../../../src/contexts/notifications/application/run-care-day";
import { isActiveOn } from "../../../../src/contexts/notifications/domain/care-schedule";
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
import type {
  CareOccurrence,
  CareOccurrenceRepository,
  ClaimAttemptInput,
  CreateCareOccurrenceInput,
  RecordAttemptInput,
} from "../../../../src/contexts/notifications/domain/care-occurrence";
import type { PushMessage, PushSendResult, PushSender } from "../../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository } from "../../../../src/contexts/notifications/domain/push-subscription";

class InMemoryCareItemRepository implements CareItemRepository {
  private items = new Map<string, CareItemWithSchedules>();

  add(item: Partial<CareItem> & Pick<CareItem, "id" | "userId">, schedule: Partial<CareSchedule> & Pick<CareSchedule, "id">): void {
    const fullItem: CareItem = { category: "medication", title: "藥物", note: null, dose: null, stock: null, stockAlert: null, ...item };
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
    const existing = this.items.get(fullItem.id);
    if (existing) existing.schedules.push(fullSchedule);
    else this.items.set(fullItem.id, { ...fullItem, schedules: [fullSchedule] });
  }

  async create(): Promise<CareItemWithSchedules> {
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
  async listActiveSchedules(): Promise<ActiveCareSchedule[]> {
    throw new Error("not used by these tests");
  }

  async listByUser(userId: string): Promise<CareItemWithSchedules[]> {
    return [...this.items.values()].filter((i) => i.userId === userId);
  }

  async listActiveSchedulesForUserOn(userId: string, localDate: string): Promise<ActiveScheduleForUser[]> {
    const result: ActiveScheduleForUser[] = [];
    for (const item of this.items.values()) {
      if (item.userId !== userId) continue;
      for (const schedule of item.schedules) {
        if (schedule.enabled && isActiveOn(schedule, localDate)) result.push({ item, schedule });
      }
    }
    return result.sort((a, b) => a.schedule.timeOfDay.localeCompare(b.schedule.timeOfDay));
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
    const log: CareLog = { id: `log-${this.nextId++}`, ...input };
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

  seed(input: CreateCareLogInput): void {
    this.bySlot.set(this.key(input.careScheduleId, input.localDate, input.timeOfDay), { id: `log-${this.nextId++}`, ...input });
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
      lastAttemptAt: null,
      lastSendOutcome: null,
      lastSendDetail: null,
    };
    this.bySlot.set(key, occurrence);
    return occurrence;
  }

  async getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareOccurrence | null> {
    return this.bySlot.get(this.key(careScheduleId, localDate, timeOfDay)) ?? null;
  }

  /** Mirrors the real repository's leased-claim semantics (gate_decision #1). */
  async claimAttempt(id: string, input: ClaimAttemptInput): Promise<boolean> {
    for (const occ of this.bySlot.values()) {
      if (occ.id !== id) continue;
      const leaseBoundaryMs = input.at.getTime() - input.leaseMinutes * 60_000;
      const stale = occ.lastAttemptAt === null || occ.lastAttemptAt.getTime() <= leaseBoundaryMs;
      if (!stale) return false;
      occ.lastAttemptAt = input.at;
      return true;
    }
    return false;
  }

  async recordAttempt(id: string, input: RecordAttemptInput): Promise<void> {
    for (const occ of this.bySlot.values()) {
      if (occ.id === id) {
        occ.lastAttemptAt = input.at;
        occ.lastSendOutcome = input.outcome;
        occ.lastSendDetail = input.detail;
        if (input.delivered) occ.lastNotifiedAt = input.at;
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

  /** Test helper: seed an occurrence with a specific attempt state directly (simulating a prior/crashed round). */
  seed(input: CreateCareOccurrenceInput & Partial<Pick<CareOccurrence, "lastAttemptAt" | "lastSendOutcome" | "lastNotifiedAt">>): CareOccurrence {
    const occurrence: CareOccurrence = {
      id: `occ-${this.nextId++}`,
      userId: input.userId,
      careItemId: input.careItemId,
      careScheduleId: input.careScheduleId,
      localDate: input.localDate,
      timeOfDay: input.timeOfDay,
      lastNotifiedAt: input.lastNotifiedAt ?? null,
      lastAttemptAt: input.lastAttemptAt ?? null,
      lastSendOutcome: input.lastSendOutcome ?? null,
      lastSendDetail: null,
    };
    this.bySlot.set(this.key(input.careScheduleId, input.localDate, input.timeOfDay), occurrence);
    return occurrence;
  }

  all(): CareOccurrence[] {
    return [...this.bySlot.values()];
  }

  async expediteNoSubscriptionsRetry(userId: string, localDate: string): Promise<void> {
    for (const occ of this.bySlot.values()) {
      if (occ.userId === userId && occ.localDate === localDate && occ.lastSendOutcome === "no_subscriptions") {
        occ.lastAttemptAt = new Date(0);
      }
    }
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

function deps(): RunCareDayDeps {
  return { careItemRepo, careLogRepo, careOccurrenceRepo, subscriptionRepo, pushSender };
}

beforeEach(() => {
  careItemRepo = new InMemoryCareItemRepository();
  careLogRepo = new InMemoryCareLogRepository();
  careOccurrenceRepo = new InMemoryCareOccurrenceRepository(careLogRepo);
  subscriptionRepo = new InMemoryPushSubscriptionRepository();
  pushSender = new ScriptedPushSender();
});

const TAIPEI = "Asia/Taipei";
// 2026-07-24 is a Friday (weekday 5); Taipei is UTC+8 (no DST).
const FRIDAY_0900_TAIPEI = new Date("2026-07-24T01:00:00Z"); // 2026-07-24 09:00 Asia/Taipei

async function addSubscription(userId: string, endpoint = `https://push.example.com/${userId}`) {
  await subscriptionRepo.upsert({ userId, endpoint, p256dh: "k", auth: "a" });
  return endpoint;
}

describe("dispatchDueRounds", () => {
  it("materializes an occurrence and dispatches a push for a current-minute match", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    const endpoint = await addSubscription("user-1");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    const occurrences = careOccurrenceRepo.all();
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ careScheduleId: "sched-1", localDate: "2026-07-24", timeOfDay: "09:00" });
    expect(occurrences[0].lastNotifiedAt).toEqual(FRIDAY_0900_TAIPEI);
    expect(pushSender.sentTo).toEqual([endpoint]);
  });

  it("fires on every day when repeat_days is empty", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });
    await addSubscription("user-1");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(1);
  });

  it("fires nothing on an inactive weekday", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [1] }); // Monday only

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing when the every-N-weeks interval is off for this week", async () => {
    careItemRepo.add(
      { id: "item-1", userId: "user-1" },
      { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], weekInterval: 2, startDate: "2026-07-01" },
    );

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing before start_date or after end_date", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-future", timeOfDay: "09:00", repeatDays: [5], startDate: "2026-08-01" });
    careItemRepo.add(
      { id: "item-2", userId: "user-1" },
      { id: "sched-ended", timeOfDay: "09:00", repeatDays: [5], startDate: "2026-07-01", endDate: "2026-07-10" },
    );

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
  });

  it("fires nothing for a disabled schedule", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], enabled: false });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
  });

  it("does not double-send when dispatchDueRounds runs twice for the same slot/instant", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(1);
    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("nag_interval_minutes = 0 fires exactly once: a later same-day round does NOT re-send", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 0 });
    await addSubscription("user-1");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 60 * 60_000), "user-1", TAIPEI, deps());

    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("re-nags after nag_interval_minutes elapses, and not before", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 10 });
    await addSubscription("user-1");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 5 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(2);
  });

  it("a successful nag interval below the retry floor is not stretched by it", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 5 });
    await addSubscription("user-1");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 5 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(2);
  });

  // D12 revised for the Workflows architecture (design.md): no_subscriptions
  // now retries at RETRY_INTERVAL_MINUTES like failed/expired, not
  // "unconditionally due" every round — immediate delivery on subscribe is
  // instead provided by subscribeWebPush calling
  // CareOccurrenceRepository.expediteNoSubscriptionsRetry (see the next
  // test), not by restartToday alone.
  it("a no_subscriptions slot waits the retry floor before becoming due again", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(0);
    expect(careOccurrenceRepo.all()[0].lastSendOutcome).toBe("no_subscriptions");

    await addSubscription("user-1");

    // +1 minute: well inside the 10-minute retry floor — must not fire yet.
    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(0);

    // +10 minutes: the retry floor has elapsed.
    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);
  });

  // D12': expediteNoSubscriptionsRetry (called by subscribeWebPush, NOT by
  // this function) is what actually delivers "near-instant after subscribe"
  // — merely restarting the instance and re-running dispatchDueRounds against
  // an unchanged occurrence row does NOT, since nextDueAt only reads
  // lastAttemptAt/lastSendOutcome off that row.
  it("expediteNoSubscriptionsRetry makes a no_subscriptions slot due immediately, well inside the retry floor", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(0);
    expect(careOccurrenceRepo.all()[0].lastSendOutcome).toBe("no_subscriptions");

    await addSubscription("user-1");
    await careOccurrenceRepo.expediteNoSubscriptionsRetry("user-1", "2026-07-24");

    // +1 minute: would still be inside the 10-minute retry floor if the
    // occurrence row had not been expedited — proves the mutation, not mere
    // elapsed time, is what makes this fire.
    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("a care_log stops the nag", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 5 });
    await addSubscription("user-1");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
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

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), "user-1", TAIPEI, deps());

    expect(pushSender.sentTo).toHaveLength(1);
  });

  // gate_decision #2: FIRST_FIRE_GRACE_MINUTES = 10 (not the earlier 30-minute draft).
  it("a late round still first-materializes a just-missed time within the 10-minute grace", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");
    const nineMinutesLate = new Date(FRIDAY_0900_TAIPEI.getTime() + 9 * 60_000);

    await dispatchDueRounds(nineMinutesLate, "user-1", TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(1);
    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("a round more than 10 minutes late never first-materializes the slot", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");
    const elevenMinutesLate = new Date(FRIDAY_0900_TAIPEI.getTime() + 11 * 60_000);

    await dispatchDueRounds(elevenMinutesLate, "user-1", TAIPEI, deps());

    expect(careOccurrenceRepo.all()).toHaveLength(0);
    expect(pushSender.sentTo).toHaveLength(0);
  });

  // gate_decision #3 — the load-bearing test: FIRST_FIRE_GRACE must NEVER be
  // consulted again once an occurrence exists. Simulates a Workflows step
  // that claimed at T then crashed before recordAttempt (lastAttemptAt = T,
  // lastSendOutcome still null) — 12 minutes later (past the 10-minute grace
  // AND past the 10-minute retry floor) a fresh round must still deliver. An
  // implementation that (wrongly) re-applies the grace window to this
  // already-materialized path would incorrectly skip it here.
  it("an abandoned claim (past the grace window) is still retried, not silently dropped", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");

    careOccurrenceRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      lastAttemptAt: FRIDAY_0900_TAIPEI, // claimed at T...
      lastSendOutcome: null, // ...but never completed (crashed before recordAttempt).
    });

    const twelveMinutesLater = new Date(FRIDAY_0900_TAIPEI.getTime() + 12 * 60_000);
    await dispatchDueRounds(twelveMinutesLater, "user-1", TAIPEI, deps());

    expect(pushSender.sentTo).toHaveLength(1);
  });

  // gate_decision #1/#3: a lost claim (another caller — or a replay of the
  // same round — already owns this attempt) must never reach the push
  // sender, even though `shouldNotify` alone would have said the round is due.
  it("a lost claim does not dispatch a push", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");
    careOccurrenceRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      // Never attempted -> shouldNotify says due -> dispatchSlot will try to claim.
    });
    const alwaysLoses: CareOccurrenceRepository = {
      ...careOccurrenceRepo,
      getBySlot: careOccurrenceRepo.getBySlot.bind(careOccurrenceRepo),
      upsertBySlot: careOccurrenceRepo.upsertBySlot.bind(careOccurrenceRepo),
      recordAttempt: careOccurrenceRepo.recordAttempt.bind(careOccurrenceRepo),
      listPastUnlogged: careOccurrenceRepo.listPastUnlogged.bind(careOccurrenceRepo),
      expediteNoSubscriptionsRetry: careOccurrenceRepo.expediteNoSubscriptionsRetry.bind(careOccurrenceRepo),
      claimAttempt: async () => false,
    };

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), careOccurrenceRepo: alwaysLoses });

    expect(pushSender.sentTo).toHaveLength(0);
    expect(careOccurrenceRepo.all()[0].lastSendOutcome).toBeNull(); // recordAttempt was never reached either.
  });

  it("isolates a failing schedule so other schedules for the same user still dispatch", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    careItemRepo.add({ id: "item-2", userId: "user-1" }, { id: "sched-2", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1", "https://push.example.com/ok");

    let calls = 0;
    const throwingSender: PushSender = {
      send: async (subscription, message) => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return pushSender.send(subscription, message);
      },
    };

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), pushSender: throwingSender });

    // The round did not throw; the second schedule's dispatch still ran.
    expect(calls).toBe(2);
  });

  it("uses a timezone parameter, not a hardcoded one: the same instant is due for a Taipei-local schedule but not for a New-York-local one", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [0, 1, 2, 3, 4, 5, 6] });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(careOccurrenceRepo.all()).toHaveLength(1); // 09:00 local in Taipei: due.

    careItemRepo.add({ id: "item-2", userId: "user-1" }, { id: "sched-2", timeOfDay: "09:00", repeatDays: [0, 1, 2, 3, 4, 5, 6] });
    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", "America/New_York", deps());
    // Same instant is 2026-07-23 21:00 in New York — sched-2 (09:00) is not due yet.
    expect(careOccurrenceRepo.all()).toHaveLength(1);
  });

  it("prunes a subscription the sender reports expired", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    const endpoint = await addSubscription("user-1", "https://push.example.com/gone");
    pushSender.resultByEndpoint.set(endpoint, { outcome: "expired", detail: "status_410" });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    expect(await subscriptionRepo.listByUser("user-1")).toEqual([]);
  });

  it("uses the medication dose as the push body when set, else the note", async () => {
    careItemRepo.add(
      { id: "item-1", userId: "user-1", category: "medication" as CareCategory, dose: "5mg", note: null },
      { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] },
    );
    careItemRepo.add(
      { id: "item-2", userId: "user-1", category: "rehab" as CareCategory, dose: null, note: "伸展 15 分鐘" },
      { id: "sched-2", timeOfDay: "09:00", repeatDays: [5] },
    );
    await addSubscription("user-1");

    const bodies: string[] = [];
    const recordingSender: PushSender = {
      send: async (_sub, message) => {
        bodies.push(message.body);
        return { outcome: "sent" };
      },
    };

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), pushSender: recordingSender });

    expect(bodies.sort()).toEqual(["5mg", "伸展 15 分鐘"]);
  });

  it("a round where every push fails is not counted as delivered, but the attempt is recorded", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    const endpoint = await addSubscription("user-1");
    pushSender.resultByEndpoint.set(endpoint, { outcome: "failed", detail: "status_500" });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    const [occurrence] = careOccurrenceRepo.all();
    expect(occurrence.lastNotifiedAt).toBeNull();
    expect(occurrence.lastAttemptAt).toEqual(FRIDAY_0900_TAIPEI);
    expect(occurrence.lastSendOutcome).toBe("failed");
    expect(occurrence.lastSendDetail).toBe("status_500");
  });

  it("a partially successful round counts as delivered, and the detail carries the round's counts", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    const okEndpoint = await addSubscription("user-1", "https://push.example.com/ok");
    const bad1 = await addSubscription("user-1", "https://push.example.com/bad-1");
    const bad2 = await addSubscription("user-1", "https://push.example.com/bad-2");
    pushSender.resultByEndpoint.set(okEndpoint, { outcome: "sent" });
    pushSender.resultByEndpoint.set(bad1, { outcome: "failed", detail: "status_401" });
    pushSender.resultByEndpoint.set(bad2, { outcome: "failed", detail: "status_500" });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    const [occurrence] = careOccurrenceRepo.all();
    expect(occurrence.lastNotifiedAt).toEqual(FRIDAY_0900_TAIPEI);
    expect(occurrence.lastSendOutcome).toBe("sent");
    expect(occurrence.lastSendDetail).toBe("sent=1 failed=2 status_401");
  });

  it("a fully successful multi-subscription round records no detail", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1", "https://push.example.com/phone");
    await addSubscription("user-1", "https://push.example.com/laptop");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    const [occurrence] = careOccurrenceRepo.all();
    expect(occurrence.lastSendOutcome).toBe("sent");
    expect(occurrence.lastSendDetail).toBeNull();
  });

  it("falls back to last_attempt_at when a 'sent' row has no last_notified_at", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 10 });
    await addSubscription("user-1");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    careOccurrenceRepo.all()[0].lastNotifiedAt = null; // simulate the hand-edited row.

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(2);
  });

  it("a failing slot whose nag interval exceeds the retry floor waits the nag interval, not the floor", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 30 });
    const endpoint = await addSubscription("user-1");
    pushSender.resultByEndpoint.set(endpoint, { outcome: "failed", detail: "status_500" });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 30 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(2);
  });

  it("a failed round that later succeeds is recorded as recovered, and re-bases the nag on the delivery", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 10 });
    const endpoint = await addSubscription("user-1");
    pushSender.resultByEndpoint.set(endpoint, { outcome: "failed", detail: "status_500" });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(careOccurrenceRepo.all()[0]).toMatchObject({ lastNotifiedAt: null, lastSendOutcome: "failed" });

    const recoveredAt = new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000);
    pushSender.resultByEndpoint.set(endpoint, { outcome: "sent" });
    await dispatchDueRounds(recoveredAt, "user-1", TAIPEI, deps());

    expect(pushSender.sentTo).toHaveLength(2);
    expect(careOccurrenceRepo.all()[0]).toMatchObject({ lastNotifiedAt: recoveredAt, lastSendOutcome: "sent" });

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 15 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(2);

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 20 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(3);
  });

  it("a persistently failing slot with nag_interval_minutes = 0 retries at the floor interval, not every round", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 0 });
    const endpoint = await addSubscription("user-1");
    pushSender.resultByEndpoint.set(endpoint, { outcome: "failed", detail: "status_500" });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(1);

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(2);
  });
});

describe("markMissedForUserDay", () => {
  it("excludes an already-logged past slot and marks an unlogged one missed exactly once", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });

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

    await markMissedForUserDay("user-1", "2026-07-24", deps());

    expect(careLogRepo.statusOf("sched-1", "2026-07-22", "09:00")).toBe("done"); // untouched
    expect(careLogRepo.statusOf("sched-1", "2026-07-23", "09:00")).toBe("missed"); // newly marked

    await markMissedForUserDay("user-1", "2026-07-24", deps()); // idempotent re-run
    expect(await careOccurrenceRepo.listPastUnlogged("sched-1", "2026-07-24")).toEqual([]);
  });

  it("marks an enabled schedule's past unanswered slots missed even when it is not active TODAY (wrong weekday)", async () => {
    // Monday-only schedule; "today" (2026-07-24) is a Friday, so it is not
    // in dispatchDueRounds's today-active set — markMissedForUserDay must
    // still see it, since it is scoped by `listByUser` + `enabled`, not by
    // `isActiveOn` for today (unlike dispatchDueRounds).
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [1] });
    await careOccurrenceRepo.upsertBySlot({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-20", // a past Monday.
      timeOfDay: "09:00",
    });

    await markMissedForUserDay("user-1", "2026-07-24", deps());

    expect(careLogRepo.statusOf("sched-1", "2026-07-20", "09:00")).toBe("missed");
  });

  it("does NOT mark a disabled schedule's past unanswered slots missed (matches the pre-existing enabled-only scan)", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], enabled: false });
    await careOccurrenceRepo.upsertBySlot({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-23",
      timeOfDay: "09:00",
    });

    await markMissedForUserDay("user-1", "2026-07-24", deps());

    expect(careLogRepo.statusOf("sched-1", "2026-07-23", "09:00")).toBeUndefined();
  });
});

describe("planNextWake (pure)", () => {
  function slot(overrides: Partial<SlotSnapshot["schedule"]> & { id: string }): CareSchedule {
    return {
      careItemId: "item-1",
      timeOfDay: "09:00",
      repeatDays: [],
      weekInterval: 1,
      startDate: "2026-07-01",
      endDate: null,
      doseQuantity: 1,
      nagIntervalMinutes: 0,
      enabled: true,
      ...overrides,
    };
  }

  it("returns null once today's local date has rolled past", () => {
    const result = planNextWake(new Date("2026-07-25T01:00:00Z"), TAIPEI, "2026-07-24", []);
    expect(result).toBeNull();
  });

  it("returns the not-yet-materialized slot's own instant when it's still ahead today", () => {
    const now = new Date("2026-07-24T00:00:00Z"); // 2026-07-24 08:00 Taipei
    const result = planNextWake(now, TAIPEI, "2026-07-24", [{ schedule: slot({ id: "s1", timeOfDay: "09:00" }), occurrence: null, answered: false }]);
    expect(result).toEqual(new Date("2026-07-24T01:00:00Z")); // 09:00 Taipei
  });

  it("still returns an immediate wake for a not-yet-materialized slot that's past due but still inside FIRST_FIRE_GRACE_MINUTES", () => {
    // Reproduces the restartToday/subscribeWebPush shape: a fresh instance's
    // very first plan-next-wake runs BEFORE any dispatch round has ever
    // touched this slot, so "past due" here does not mean "already
    // dispatched" — the slot must still get a wake or it silently never fires.
    const now = new Date("2026-07-24T01:05:00Z"); // 09:05 Taipei — 5 min past a 09:00 slot, within the 10-min grace.
    const result = planNextWake(now, TAIPEI, "2026-07-24", [{ schedule: slot({ id: "s1", timeOfDay: "09:00" }), occurrence: null, answered: false }]);
    expect(result).toEqual(now); // wake immediately so dispatch-due-rounds still lands inside the grace window.
  });

  it("drops a not-yet-materialized slot once FIRST_FIRE_GRACE_MINUTES has fully closed", () => {
    const now = new Date("2026-07-24T01:15:00Z"); // 09:15 Taipei — 15 min past a 09:00 slot, past the 10-min grace.
    const result = planNextWake(now, TAIPEI, "2026-07-24", [{ schedule: slot({ id: "s1", timeOfDay: "09:00" }), occurrence: null, answered: false }]);
    expect(result).toEqual(new Date("2026-07-24T16:00:00Z")); // only the midnight candidate remains — markMissed handles it tomorrow.
  });

  it("takes the minimum across several slots and the local midnight boundary", () => {
    const now = new Date("2026-07-24T00:00:00Z"); // 08:00 Taipei
    const result = planNextWake(now, TAIPEI, "2026-07-24", [
      { schedule: slot({ id: "s1", timeOfDay: "09:00" }), occurrence: null, answered: false },
      { schedule: slot({ id: "s2", timeOfDay: "20:00" }), occurrence: null, answered: false },
    ]);
    // 09:00 Taipei is earlier than both 20:00 Taipei and local midnight.
    expect(result).toEqual(new Date("2026-07-24T01:00:00Z"));
  });

  it("falls back to local midnight when every slot is terminated (answered or nag=0-and-sent)", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const sentOccurrence: CareOccurrence = {
      id: "occ-1",
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "s1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      lastNotifiedAt: FRIDAY_0900_TAIPEI,
      lastAttemptAt: FRIDAY_0900_TAIPEI,
      lastSendOutcome: "sent",
      lastSendDetail: null,
    };
    const result = planNextWake(now, TAIPEI, "2026-07-24", [
      { schedule: slot({ id: "s1", timeOfDay: "09:00", nagIntervalMinutes: 0 }), occurrence: sentOccurrence, answered: false },
    ]);
    expect(result).toEqual(new Date("2026-07-24T16:00:00Z")); // next local midnight = 2026-07-25 00:00 Taipei.
  });

  it("plans the next wake for a re-nagging slot at lastNotifiedAt + nagIntervalMinutes", () => {
    const now = new Date("2026-07-24T01:00:00Z");
    const occurrence: CareOccurrence = {
      id: "occ-1",
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "s1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      lastNotifiedAt: now,
      lastAttemptAt: now,
      lastSendOutcome: "sent",
      lastSendDetail: null,
    };
    const result = planNextWake(now, TAIPEI, "2026-07-24", [
      { schedule: slot({ id: "s1", timeOfDay: "09:00", nagIntervalMinutes: 15 }), occurrence, answered: false },
    ]);
    expect(result).toEqual(new Date(now.getTime() + 15 * 60_000));
  });

  it("ignores an answered slot even if its occurrence would otherwise still be due", () => {
    const now = new Date("2026-07-24T01:00:00Z");
    const occurrence: CareOccurrence = {
      id: "occ-1",
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "s1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      lastNotifiedAt: null,
      lastAttemptAt: null,
      lastSendOutcome: null,
      lastSendDetail: null,
    };
    const result = planNextWake(now, TAIPEI, "2026-07-24", [
      { schedule: slot({ id: "s1", timeOfDay: "09:00" }), occurrence, answered: true },
    ]);
    expect(result).toEqual(new Date("2026-07-24T16:00:00Z")); // only the midnight candidate remains.
  });

  // DST: the not-yet-materialized branch calls utcInstantFor, so a slot whose
  // wall-clock time falls in a spring-forward gap must resolve to the first
  // legal instant after the gap (D1' in design.md), matching
  // `utcInstantFor`'s own contract.
  it("resolves a not-yet-materialized slot's wake instant through a spring-forward gap", () => {
    const now = new Date("2026-03-08T05:00:00Z"); // 00:00 EST, well before the 07:00Z transition.
    const result = planNextWake(now, "America/New_York", "2026-03-08", [
      { schedule: slot({ id: "s1", timeOfDay: "02:30" }), occurrence: null, answered: false },
    ]);
    expect(result).toEqual(new Date("2026-03-08T07:00:00Z"));
  });
});

describe("buildSlotSnapshots", () => {
  it("reads today's active schedules and their occurrence/log state fresh from the repositories", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");
    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps()); // materializes + sends.

    const { todayLocalDate, slots } = await buildSlotSnapshots("user-1", TAIPEI, FRIDAY_0900_TAIPEI, deps());

    expect(todayLocalDate).toBe("2026-07-24");
    expect(slots).toHaveLength(1);
    expect(slots[0].occurrence?.lastSendOutcome).toBe("sent");
    expect(slots[0].answered).toBe(false);
  });
});
