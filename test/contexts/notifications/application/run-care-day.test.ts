import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSlotSnapshots,
  dispatchDueRounds,
  markMissedForUserDay,
  planNextWake,
  type RunCareDayDeps,
  type SlotSnapshot,
} from "../../../../src/contexts/notifications/application/run-care-day";
import { createWebPushProbe } from "../../../helpers/web-push-probe";
import { recordSubrequest, remainingSubrequestBudget, withSubrequestBudget } from "../../../../src/shared/db/subrequest-budget";
import { hashAckToken } from "../../../../src/contexts/notifications/domain/ack-token";
import type { PushDeliveryRegistration, PushDeliveryRepository } from "../../../../src/contexts/notifications/domain/push-delivery";
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
import type { PushSubscription, PushSubscriptionRepository, PushSubscriptionKeys } from "../../../../src/contexts/notifications/domain/push-subscription";

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

  async listByUserAndDate(userId: string, localDate: string): Promise<CareLog[]> {
    return [...this.bySlot.values()].filter((l) => l.userId === userId && l.localDate === localDate);
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

  async listByUserAndDate(userId: string, localDate: string): Promise<CareOccurrence[]> {
    return [...this.bySlot.values()].filter((o) => o.userId === userId && o.localDate === localDate);
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

  async listPastUnloggedForUser(userId: string, todayLocalDate: string): Promise<CareOccurrence[]> {
    const past = [...this.bySlot.values()].filter((o) => o.userId === userId && o.localDate < todayLocalDate);
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

class ScriptedPushSender implements PushSender {
  resultByEndpoint = new Map<string, PushSendResult>();
  sentTo: string[] = [];

  async send(subscription: PushSubscriptionKeys, _message: PushMessage): Promise<PushSendResult> {
    this.sentTo.push(subscription.endpoint);
    return this.resultByEndpoint.get(subscription.endpoint) ?? { outcome: "sent" };
  }
}

class InMemoryPushDeliveryRepository implements PushDeliveryRepository {
  rows: PushDeliveryRegistration[] = [];

  async registerSent(rows: PushDeliveryRegistration[]): Promise<void> {
    this.rows.push(...rows);
  }
  async markAcked(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
}

let careItemRepo: InMemoryCareItemRepository;
let careLogRepo: InMemoryCareLogRepository;
let careOccurrenceRepo: InMemoryCareOccurrenceRepository;
let subscriptionRepo: InMemoryPushSubscriptionRepository;
let pushSender: ScriptedPushSender;
let pushDeliveryRepo: InMemoryPushDeliveryRepository;

function deps(): RunCareDayDeps {
  return { careItemRepo, careLogRepo, careOccurrenceRepo, subscriptionRepo, pushSender, pushDeliveryRepo, remainingSubrequestBudget };
}

function resetRepos(): void {
  careItemRepo = new InMemoryCareItemRepository();
  careLogRepo = new InMemoryCareLogRepository();
  careOccurrenceRepo = new InMemoryCareOccurrenceRepository(careLogRepo);
  subscriptionRepo = new InMemoryPushSubscriptionRepository();
  pushSender = new ScriptedPushSender();
  pushDeliveryRepo = new InMemoryPushDeliveryRepository();
}

beforeEach(resetRepos);

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
      listByUserAndDate: careOccurrenceRepo.listByUserAndDate.bind(careOccurrenceRepo),
      listPastUnloggedForUser: careOccurrenceRepo.listPastUnloggedForUser.bind(careOccurrenceRepo),
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

  it("registers every delivery row BEFORE the first push goes out", async () => {
    // A device can display the notification and POST its ack while this round
    // is still running. An ack that arrives before its row exists finds nothing
    // to update and is lost forever, so the ordering is the guard, not the
    // eventual presence of the rows.
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1", "https://push.example.com/a");
    await addSubscription("user-1", "https://push.example.com/b");

    const rowsSeenAtFirstSend: number[] = [];
    const observingSender: PushSender = {
      send: async () => {
        rowsSeenAtFirstSend.push(pushDeliveryRepo.rows.length);
        return { outcome: "sent" };
      },
    };

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), pushSender: observingSender });

    expect(rowsSeenAtFirstSend).toEqual([2, 2]);
  });

  it("gives each subscription its own ack token, and stores only the hashes", async () => {
    // Two devices, two payloads, two tokens: one device's ack must never be
    // able to speak for another's. Minting once outside the loop would still
    // deliver, still record two rows, and still pass every older test here.
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1", "https://push.example.com/a");
    await addSubscription("user-1", "https://push.example.com/b");

    const tokens: string[] = [];
    const recordingSender: PushSender = {
      send: async (_sub, message) => {
        tokens.push((message.data as { ack: string }).ack);
        return { outcome: "sent" };
      },
    };

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), pushSender: recordingSender });

    expect(new Set(tokens).size).toBe(2);
    const storedHashes = pushDeliveryRepo.rows.map((r) => r.tokenHash).sort();
    expect(storedHashes).toEqual((await Promise.all(tokens.map(hashAckToken))).sort());
    // The plaintext token must not be recoverable from the row.
    for (const token of tokens) expect(JSON.stringify(pushDeliveryRepo.rows)).not.toContain(token);
  });

  it("attributes each delivery row to the occurrence and the subscription it was sent to, and expires it at sent_at + the TTL used", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 5 });
    await addSubscription("user-1", "https://push.example.com/a");

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    const [occurrence] = careOccurrenceRepo.all();
    const [subscription] = await subscriptionRepo.listByUser("user-1");
    expect(pushDeliveryRepo.rows).toHaveLength(1);
    expect(pushDeliveryRepo.rows[0]).toMatchObject({
      careOccurrenceId: occurrence.id,
      pushSubscriptionId: subscription.id,
      sentAt: FRIDAY_0900_TAIPEI,
      expiresAt: new Date(FRIDAY_0900_TAIPEI.getTime() + 5 * 60 * 1000),
    });
  });

  it("still sends, and still records the attempt, when registering the delivery rows fails", async () => {
    // Bookkeeping must never be able to swallow a medication reminder. The
    // claim is already taken by the time registerSent runs, so an exception
    // escaping it would skip every send AND recordAttempt, leaving the
    // occurrence looking like an abandoned claim — no push at all, and the
    // next retry a full nag/retry interval away. Neon 520s and Workers
    // CPU-limit kills make that a real transient, not a hypothetical.
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    const endpoint = await addSubscription("user-1");
    const failingDeliveryRepo: PushDeliveryRepository = {
      registerSent: async () => {
        throw new Error("neon 520");
      },
      markAcked: async () => false,
    };

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), pushDeliveryRepo: failingDeliveryRepo });

    expect(pushSender.sentTo).toEqual([endpoint]);
    const [occurrence] = careOccurrenceRepo.all();
    expect(occurrence.lastSendOutcome).toBe("sent");
    expect(occurrence.lastNotifiedAt).toEqual(FRIDAY_0900_TAIPEI);
  });

  it("a round with no subscriptions registers no delivery rows", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    expect(pushDeliveryRepo.rows).toEqual([]);
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

/**
 * These assert the headers an injected `fetchImpl` actually receives, with the
 * real `WebPushSender` in the chain — not the constants the caller passes. The
 * pre-change hardcoded `TTL: 60` was invisible to every test in this repo
 * because the only TTL assertion anywhere was `toBeTruthy()`.
 */
describe("dispatchDueRounds: what reaches the push service", () => {
  async function dispatchThroughRealSender(nagIntervalMinutes: number): Promise<Headers> {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes });
    const probe = await createWebPushProbe();
    await subscriptionRepo.upsert(probe.subscription);

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), pushSender: probe.sender });

    expect(probe.requests).toHaveLength(1);
    return new Headers(probe.requests[0].headers);
  }

  it("a nagging slot's TTL is its own nag interval, so at most one copy of a slot is ever live", async () => {
    expect((await dispatchThroughRealSender(5)).get("TTL")).toBe("300");
  });

  it("a fire-once slot's TTL is the first-fire grace window instead", async () => {
    // Deliberately paired with the case above, on opposite sides of the
    // `nagIntervalMinutes > 0` branch: collapsing the two arms to one value
    // fails exactly one of them.
    expect((await dispatchThroughRealSender(0)).get("TTL")).toBe("600");
  });

  it("care reminders go out with Urgency: high", async () => {
    expect((await dispatchThroughRealSender(5)).get("Urgency")).toBe("high");
  });
});

/**
 * The whole point of fix-care-reminder-subrequest-n-plus-1: every read on the
 * reminder path is O(1) in the schedule count. Each test asserts BOTH halves
 * design.md D8 requires — the count at N=25 equals the count at N=1 (the
 * decoupling) AND that count equals a literal. Half (1) alone survives a
 * mutation that makes both counts equally wrong; half (2) alone survives a
 * mutation that changes the constant but keeps it constant.
 *
 * These count *repository read calls*, not subrequests — the fakes never reach
 * `retry-fetch.ts`. The "one repository read == one subrequest" half is
 * asserted separately, against real SQL, in
 * test/db/care-occurrence-batch-reads.test.ts.
 */
describe("read counts are independent of the schedule count (design.md D1/D8)", () => {
  /**
   * Read methods only. Writes are deliberately excluded: they stay per slot by
   * design (D2), so counting them would make these tests fail for a change the
   * design explicitly sanctions.
   */
  const READ_METHODS = new Set([
    "listActiveSchedulesForUserOn",
    "listByUser",
    "getBySlot",
    "listByUserAndDate",
    "listByUserAndDateRange",
    "listPastUnlogged",
    "listPastUnloggedForUser",
  ]);

  function countingRepo<T extends object>(repo: T, reads: string[]): T {
    return new Proxy(repo, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (typeof value !== "function") return value;
        const bound = (value as (...args: unknown[]) => unknown).bind(target);
        if (typeof prop !== "string" || !READ_METHODS.has(prop)) return bound;
        return (...args: unknown[]) => {
          reads.push(prop);
          return bound(...args);
        };
      },
    }) as T;
  }

  function countingDeps(reads: string[]): RunCareDayDeps {
    return {
      careItemRepo: countingRepo(careItemRepo, reads),
      careLogRepo: countingRepo(careLogRepo, reads),
      careOccurrenceRepo: countingRepo(careOccurrenceRepo, reads),
      subscriptionRepo: countingRepo(subscriptionRepo, reads),
      pushSender,
      pushDeliveryRepo,
      remainingSubrequestBudget,
    };
  }

  /** 10:00, 10:01, ... — all strictly after the 09:00 the tests' `now` is, so nothing is due. */
  const notYetDue = (i: number) => `10:${String(i).padStart(2, "0")}`;

  function addSchedules(n: number, timeAt: (i: number) => string): void {
    for (let i = 0; i < n; i++) {
      careItemRepo.add({ id: `item-${i}`, userId: "user-1" }, { id: `sched-${i}`, timeOfDay: timeAt(i), repeatDays: [5] });
    }
  }

  async function readsFor(n: number, run: (d: RunCareDayDeps) => Promise<unknown>): Promise<string[]> {
    resetRepos();
    addSchedules(n, notYetDue);
    const reads: string[] = [];
    await run(countingDeps(reads));
    return reads;
  }

  it("buildSlotSnapshots: 25 schedules cost the same 3 reads as 1", async () => {
    const one = await readsFor(1, (d) => buildSlotSnapshots("user-1", TAIPEI, FRIDAY_0900_TAIPEI, d));
    const many = await readsFor(25, (d) => buildSlotSnapshots("user-1", TAIPEI, FRIDAY_0900_TAIPEI, d));

    expect(many).toHaveLength(one.length);
    expect(one).toHaveLength(3);
    expect([...one].sort()).toEqual(["listActiveSchedulesForUserOn", "listByUserAndDate", "listByUserAndDate"]);
  });

  it("dispatchDueRounds: a round with nothing due costs the same 4 reads for 25 schedules as for 1", async () => {
    const one = await readsFor(1, (d) => dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, d));
    const many = await readsFor(25, (d) => dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, d));

    expect(many).toHaveLength(one.length);
    expect(one).toHaveLength(4);
    expect([...one].sort()).toEqual(["listActiveSchedulesForUserOn", "listByUser", "listByUserAndDate", "listByUserAndDate"]);
  });

  /**
   * The "nothing due" fixture above returns from `dispatchSlot` at its very
   * first line (`candidateMinute > nowMinute`) — before the function ever
   * looks at `slotState.occurrence` or `slotState.answered`. A per-schedule
   * `getBySlot`/`listPastUnlogged` reinserted anywhere AFTER that early return
   * would never run for that fixture and this pair of tests would stay green
   * regardless (confirmed by mutation: see D8's revert-and-confirm-red note).
   * This fixture instead makes every slot DUE — so `dispatchSlot` walks past
   * that guard — while already answered, so it still touches zero writes and
   * the read count stays the batched constant.
   */
  it("dispatchDueRounds: a round where every slot is due but already answered costs the same 4 reads for 25 schedules as for 1", async () => {
    const dueTimeAt = (i: number) => `08:${String(i).padStart(2, "0")}`; // strictly before 09:00, so all due.

    async function readsForDueAnswered(n: number): Promise<string[]> {
      resetRepos();
      addSchedules(n, dueTimeAt);
      for (let i = 0; i < n; i++) {
        await careOccurrenceRepo.upsertBySlot({
          userId: "user-1",
          careItemId: `item-${i}`,
          careScheduleId: `sched-${i}`,
          localDate: "2026-07-24",
          timeOfDay: dueTimeAt(i),
        });
        await careLogRepo.upsertIfAbsent({
          userId: "user-1",
          careItemId: `item-${i}`,
          careScheduleId: `sched-${i}`,
          localDate: "2026-07-24",
          timeOfDay: dueTimeAt(i),
          status: "done",
          doneTime: FRIDAY_0900_TAIPEI,
          doseQuantity: 1,
        });
      }
      const reads: string[] = [];
      await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, countingDeps(reads));
      return reads;
    }

    const one = await readsForDueAnswered(1);
    const many = await readsForDueAnswered(25);

    expect(many).toHaveLength(one.length);
    expect(one).toHaveLength(4);
    expect([...one].sort()).toEqual(["listActiveSchedulesForUserOn", "listByUser", "listByUserAndDate", "listByUserAndDate"]);
    // Every slot was already answered, so nothing was claimed or dispatched —
    // this is a read-count guard, not a dispatch one.
    expect(pushSender.sentTo).toHaveLength(0);
  });

  it("markMissedForUserDay: 25 enabled schedules cost the same 2 reads as 1, and mark the same slots", async () => {
    async function measure(n: number): Promise<{ reads: string[]; missed: string[] }> {
      resetRepos();
      addSchedules(n, notYetDue);
      for (let i = 0; i < n; i++) {
        await careOccurrenceRepo.upsertBySlot({
          userId: "user-1",
          careItemId: `item-${i}`,
          careScheduleId: `sched-${i}`,
          localDate: "2026-07-23",
          timeOfDay: notYetDue(i),
        });
      }
      const reads: string[] = [];
      await markMissedForUserDay("user-1", "2026-07-24", countingDeps(reads));
      const missed = careLogRepo
        .all()
        .filter((l) => l.status === "missed")
        .map((l) => `${l.careScheduleId}|${l.localDate}|${l.timeOfDay}`)
        .sort();
      return { reads, missed };
    }

    const one = await measure(1);
    const many = await measure(25);

    expect(many.reads).toHaveLength(one.reads.length);
    expect(one.reads).toHaveLength(2);
    expect([...one.reads].sort()).toEqual(["listByUser", "listPastUnloggedForUser"]);
    // Same slots marked, not merely the same read count.
    expect(one.missed).toEqual(["sched-0|2026-07-23|10:00"]);
    expect(many.missed).toHaveLength(25);
    expect(many.missed).toContain("sched-24|2026-07-23|10:24");
  });

  it("reads the user's push subscriptions once for a round in which several slots are due", async () => {
    resetRepos();
    addSchedules(3, () => "09:00"); // all three due at the same instant.
    await addSubscription("user-1");

    const reads: string[] = [];
    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, countingDeps(reads));

    // `careItemRepo.listByUser` is not on this path, so every `listByUser` here
    // is the subscription read.
    expect(reads.filter((r) => r === "listByUser")).toHaveLength(1);
    expect(pushSender.sentTo).toHaveLength(3); // ...and all three slots really did dispatch.
  });

  it("a subscription pruned as expired by one slot is not sent to again by a later slot in the same round", async () => {
    resetRepos();
    addSchedules(2, () => "09:00");
    const gone = await addSubscription("user-1", "https://push.example.com/gone");
    const alive = await addSubscription("user-1", "https://push.example.com/alive");
    pushSender.resultByEndpoint.set(gone, { outcome: "expired", detail: "status_410" });

    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());

    // The round reads the subscription list once, so the prune has to be
    // applied to that shared list — otherwise the second slot pushes to an
    // endpoint the first slot already proved gone.
    expect(pushSender.sentTo.filter((e) => e === gone)).toHaveLength(1);
    expect(pushSender.sentTo.filter((e) => e === alive)).toHaveLength(2);
  });
});

/**
 * Every repository call and every push send is one Neon / Web-Push `fetch`,
 * i.e. one Cloudflare subrequest. The in-memory fakes issue no fetch at all, so
 * the budget only moves in these tests if this wrapper records it — which is
 * what lets a test run `dispatchDueRounds` inside a real `withSubrequestBudget`
 * scope and watch the brake engage.
 */
function spendingDeps(base: RunCareDayDeps): RunCareDayDeps {
  const spending = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(t, prop) {
        const value = Reflect.get(t, prop) as unknown;
        if (typeof value !== "function") return value;
        const bound = (value as (...a: unknown[]) => unknown).bind(t);
        return (...args: unknown[]) => {
          recordSubrequest();
          return bound(...args);
        };
      },
    }) as T;
  return {
    careItemRepo: spending(base.careItemRepo),
    careLogRepo: spending(base.careLogRepo),
    careOccurrenceRepo: spending(base.careOccurrenceRepo),
    subscriptionRepo: spending(base.subscriptionRepo),
    pushSender: spending(base.pushSender),
    pushDeliveryRepo: spending(base.pushDeliveryRepo),
    // Passed through, never proxied: reading the remaining budget is not itself
    // a subrequest.
    remainingSubrequestBudget: base.remainingSubrequestBudget,
  };
}

/**
 * Collects a console channel's output into an array. Read through the array,
 * not `spy.mock.calls`: `mockRestore()` resets the mock, so the calls are gone
 * by the time a `finally`-restored spy is inspected.
 */
function captureConsole(channel: "warn" | "error"): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("dispatchDueRounds: the subrequest budget brake (design.md D4)", () => {
  // The arithmetic these budgets are chosen from, with `spendingDeps` counting
  // one subrequest per call:
  //   round setup            4 (the three batch reads + the subscription read)
  //   the ENTRY GATE's cost   7 (SLOT_DISPATCH_WRITES(4) +
  //                             PER_SUBSCRIPTION_WORST_CASE(2) for one send's
  //                             worst case + FAILURE_RECORD_RESERVE(1)) — a
  //                             FIXED cost, never multiplied by the slot's
  //                             actual subscription count (that used to be
  //                             the starvation bug: past ~21 subscriptions the
  //                             old scaled gate exceeded even a fresh round's
  //                             budget and deferred every wake, forever).
  //   one slot's ACTUAL cost 5 (upsertBySlot, claimAttempt, registerSent, send,
  //                             recordAttempt — no failure-recording write, and
  //                             no delete since the subscription is never expired)
  //   for S=1
  // so with R remaining after setup, floor((R - 7) / 5) + 1 slots are served
  // when each due slot has exactly one subscription (D4's earliest-first
  // multi-slot tests). A single slot with MANY subscriptions is governed
  // instead by the per-send loop check inside `sendClaimedSlot` — see the
  // tests below.
  const ROUND_SETUP = 4;
  const SLOT_WORST_CASE = 7;
  const SLOT_ACTUAL_COST = 5;
  /** 4 writes + 1 send + 1 reserve — what the estimate would be without the deleteByEndpoint reserve. */
  const SLOT_DISPATCH_WRITES_PLUS_ONE_SEND_PLUS_RESERVE = 6;

  it("stops before claiming a slot it cannot afford, logs the deferral, and leaves that slot untouched", async () => {
    // 08:55 and 09:00 are both due at 09:00 (08:55 is inside the 10-minute
    // first-fire grace), so only the budget decides how many go out.
    careItemRepo.add({ id: "item-a", userId: "user-1" }, { id: "sched-a", timeOfDay: "08:55", repeatDays: [5] });
    careItemRepo.add({ id: "item-b", userId: "user-1" }, { id: "sched-b", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");

    const warn = captureConsole("warn");
    try {
      await withSubrequestBudget(ROUND_SETUP + SLOT_WORST_CASE, () =>
        dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, spendingDeps(deps())),
      );
    } finally {
      warn.restore();
    }

    expect(pushSender.sentTo).toHaveLength(1);
    // The deferred slot was never even materialized, so nothing about it is
    // claimed: the next wake finds it exactly as it was.
    expect(careOccurrenceRepo.all().map((o) => o.timeOfDay)).toEqual(["08:55"]);
    expect(warn.lines).toEqual(["care-dispatch: deferred 1 slots, subrequest budget exhausted"]);
  });

  it("reserves headroom for a possible deleteByEndpoint, not just the send, per subscription", async () => {
    // One due slot, one subscription: SLOT_DISPATCH_WRITES(4) + 1 send + 1
    // reserve = 6 — exactly what the estimate would be WITHOUT the
    // deleteByEndpoint reserve. A budget of ROUND_SETUP + 6 therefore "fits"
    // that under-counted formula but must NOT fit the real one
    // (ROUND_SETUP + 7): a subscription that comes back `expired` costs a
    // second subrequest (`subscriptionRepo.deleteByEndpoint`) this estimate
    // has to cover before it is known which outcome the send will get.
    careItemRepo.add({ id: "item-a", userId: "user-1" }, { id: "sched-a", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");

    const warn = captureConsole("warn");
    try {
      await withSubrequestBudget(ROUND_SETUP + SLOT_DISPATCH_WRITES_PLUS_ONE_SEND_PLUS_RESERVE, () =>
        dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, spendingDeps(deps())),
      );
    } finally {
      warn.restore();
    }

    expect(pushSender.sentTo).toHaveLength(0);
    expect(careOccurrenceRepo.all()).toHaveLength(0);
    expect(warn.lines).toEqual(["care-dispatch: deferred 1 slots, subrequest budget exhausted"]);
  });

  it("serves the earliest scheduled times first, whatever order the repository returns them in", async () => {
    careItemRepo.add({ id: "item-a", userId: "user-1" }, { id: "sched-a", timeOfDay: "08:55", repeatDays: [5] });
    careItemRepo.add({ id: "item-b", userId: "user-1" }, { id: "sched-b", timeOfDay: "08:58", repeatDays: [5] });
    careItemRepo.add({ id: "item-c", userId: "user-1" }, { id: "sched-c", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1");

    // Latest-first, so passing this can only come from the loop's own sort.
    const reversed: CareItemRepository = {
      ...careItemRepo,
      listByUser: careItemRepo.listByUser.bind(careItemRepo),
      listActiveSchedulesForUserOn: async (userId: string, localDate: string) =>
        (await careItemRepo.listActiveSchedulesForUserOn(userId, localDate)).reverse(),
    } as unknown as CareItemRepository;

    const warn = captureConsole("warn");
    try {
      // Room for two of the three slots.
      await withSubrequestBudget(ROUND_SETUP + SLOT_WORST_CASE + SLOT_ACTUAL_COST + 1, () =>
        dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, spendingDeps({ ...deps(), careItemRepo: reversed })),
      );
    } finally {
      warn.restore();
    }

    expect(careOccurrenceRepo.all().map((o) => o.timeOfDay).sort()).toEqual(["08:55", "08:58"]);
  });

  it("the slot-entry gate does NOT scale with subscription count: a large fleet is claimed on the same budget a single-subscription slot needs", async () => {
    // Structural fix (superseding the "scales the reserve" test this used to
    // be): the entry gate charges a FIXED cost, `SLOT_DISPATCH_WRITES(4) +
    // PER_SUBSCRIPTION_WORST_CASE(2) + FAILURE_RECORD_RESERVE(1) = 7`, no
    // matter how large the subscription fleet is. A gate that still
    // multiplied by `subscriptions.length` would defer this 25-subscription
    // slot at ROUND_SETUP + 7 exactly as it would a 100-subscription one; the
    // fixed gate claims it every time. `sendClaimedSlot`'s own per-send check
    // is what keeps the loop itself inside budget as sends actually happen —
    // see the next tests.
    careItemRepo.add({ id: "item-a", userId: "user-1" }, { id: "sched-a", timeOfDay: "09:00", repeatDays: [5] });
    for (let i = 0; i < 25; i++) await addSubscription("user-1", `https://push.example.com/device-${i}`);

    await withSubrequestBudget(ROUND_SETUP + SLOT_WORST_CASE, () =>
      dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, spendingDeps(deps())),
    );

    // Claimed and attempted — not silently deferred just because the fleet is large.
    expect(careOccurrenceRepo.all()).toHaveLength(1);
    expect(careOccurrenceRepo.all()[0].lastAttemptAt).not.toBeNull();
  });

  it("a large fleet with a fresh, full-sized round budget is dispatched to in full, never permanently deferred", async () => {
    // This is the regression the finding named directly: the old
    // `SLOT_DISPATCH_WRITES + 2 * subscriptions.length + FAILURE_RECORD_RESERVE`
    // entry gate made `subscriptions.length` past roughly 21 unaffordable on
    // EVERY wake (every wake starts from the same fresh 50-request budget), so
    // a user who accumulated that many stale subscriptions (a documented
    // failure mode of this repo's PWA reinstall flow) had every medication
    // reminder silently stop, forever, with no self-healing — the pruning of a
    // stale subscription only happens on an actual send. 25 subscriptions, all
    // reachable, on a completely fresh round: every one of them gets sent to,
    // in the same wake.
    careItemRepo.add({ id: "item-a", userId: "user-1" }, { id: "sched-a", timeOfDay: "09:00", repeatDays: [5] });
    for (let i = 0; i < 25; i++) await addSubscription("user-1", `https://push.example.com/device-${i}`);

    await withSubrequestBudget(ROUND_SETUP + 46, () =>
      dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, spendingDeps(deps())),
    );

    expect(pushSender.sentTo).toHaveLength(25);
    const occurrence = careOccurrenceRepo.all()[0];
    expect(occurrence.lastSendOutcome).toBe("sent");
    expect(occurrence.lastNotifiedAt).not.toBeNull();
  });

  it("stops sending mid-slot when the budget runs out inside the per-subscription loop, and still records the round's outcome", async () => {
    // A slot with 3 subscriptions, but a budget sized to afford the entry
    // gate (7) plus exactly one send: after the 3 unconditional writes
    // (upsertBySlot, claimAttempt, registerSent) the loop has 4 left, which
    // clears the per-send check (PER_SUBSCRIPTION_WORST_CASE(2) +
    // SLOT_TAIL_RESERVE(2) = 4) for the first subscription but not the
    // second. This is the structural replacement for the old all-or-nothing
    // gate: instead of the whole slot being unaffordable, it delivers to as
    // many devices as the round can afford and still records an outcome —
    // recordAttempt is guaranteed room by `SLOT_TAIL_RESERVE`, which the loop
    // check never spends.
    careItemRepo.add({ id: "item-a", userId: "user-1" }, { id: "sched-a", timeOfDay: "09:00", repeatDays: [5] });
    await addSubscription("user-1", "https://push.example.com/a");
    await addSubscription("user-1", "https://push.example.com/b");
    await addSubscription("user-1", "https://push.example.com/c");

    const warn = captureConsole("warn");
    try {
      await withSubrequestBudget(ROUND_SETUP + SLOT_WORST_CASE, () =>
        dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, spendingDeps(deps())),
      );
    } finally {
      warn.restore();
    }

    expect(pushSender.sentTo).toHaveLength(1);
    const occurrence = careOccurrenceRepo.all()[0];
    // Partial success still counts as delivered (D10) — the one device that got it did.
    expect(occurrence.lastSendOutcome).toBe("sent");
    expect(occurrence.lastNotifiedAt).not.toBeNull();
    expect(warn.lines.some((line) => line.startsWith("care-dispatch: stopped mid-slot after 1/3 sends, subrequest budget exhausted"))).toBe(true);
  });

  it("a deferred slot is still due on the next wake — planned for immediately, not a nag interval later — and then dispatches", async () => {
    careItemRepo.add({ id: "item-a", userId: "user-1" }, { id: "sched-a", timeOfDay: "08:55", repeatDays: [5], nagIntervalMinutes: 30 });
    careItemRepo.add({ id: "item-b", userId: "user-1" }, { id: "sched-b", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 30 });
    await addSubscription("user-1");

    const warn = captureConsole("warn");
    try {
      await withSubrequestBudget(ROUND_SETUP + SLOT_WORST_CASE, () =>
        dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, spendingDeps(deps())),
      );
    } finally {
      warn.restore();
    }
    expect(pushSender.sentTo).toHaveLength(1);

    // The wake planned right after the deferral is NOW, not 30 minutes later:
    // the deferred slot is unmaterialized and still inside its grace window.
    const { todayLocalDate, slots } = await buildSlotSnapshots("user-1", TAIPEI, FRIDAY_0900_TAIPEI, deps());
    expect(planNextWake(FRIDAY_0900_TAIPEI, TAIPEI, todayLocalDate, slots)).toEqual(FRIDAY_0900_TAIPEI);

    // ...and that next round, with its own fresh budget, delivers it.
    await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, deps());
    expect(pushSender.sentTo).toHaveLength(2);
    expect(careOccurrenceRepo.all().map((o) => o.timeOfDay).sort()).toEqual(["08:55", "09:00"]);
  });
});

describe("dispatchDueRounds: a dispatch that throws after claiming is recorded and logged (design.md D5)", () => {
  const ENDPOINT = "https://push.example.com/device-abcdefghijklmnopqrstuvwxyz";
  const AUTH = "aUtHsEcReT0123456789xy";

  async function addRealisticSubscription(userId: string): Promise<void> {
    await subscriptionRepo.upsert({
      userId,
      endpoint: ENDPOINT,
      p256dh: "BPp256dhPUBLICKEY0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345678",
      auth: AUTH,
    });
  }

  /** The realistic shape: a push-sender failure names the endpoint it was talking to. */
  function throwingSender(times = Number.POSITIVE_INFINITY): PushSender {
    let calls = 0;
    return {
      send: async (subscription, message) => {
        calls++;
        if (calls <= times) throw new Error(`web push POST ${ENDPOINT} failed (auth=${AUTH})`);
        return pushSender.send(subscription, message);
      },
    };
  }

  it("records the attempt as failed with a diagnostic that names neither the endpoint nor the keys", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5] });
    await addRealisticSubscription("user-1");

    const error = captureConsole("error");
    try {
      await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), pushSender: throwingSender() });
    } finally {
      error.restore();
    }

    const [occurrence] = careOccurrenceRepo.all();
    expect(occurrence.lastAttemptAt).toEqual(FRIDAY_0900_TAIPEI);
    expect(occurrence.lastSendOutcome).toBe("failed"); // NOT left with an attempt time and no outcome.
    expect(occurrence.lastSendDetail).toBeTruthy();
    expect(occurrence.lastSendDetail).toContain("Error");
    expect(occurrence.lastSendDetail).not.toContain(ENDPOINT);
    expect(occurrence.lastSendDetail).not.toContain("push.example.com");
    expect(occurrence.lastSendDetail).not.toContain(AUTH);
  });

  it("logs the failure with its schedule id and the error chain, and still dispatches the rest of the round", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "08:55", repeatDays: [5] });
    careItemRepo.add({ id: "item-2", userId: "user-1" }, { id: "sched-2", timeOfDay: "09:00", repeatDays: [5] });
    await addRealisticSubscription("user-1");

    const error = captureConsole("error");
    try {
      await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, { ...deps(), pushSender: throwingSender(1) });
    } finally {
      error.restore();
    }

    const logged = error.lines;
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("sched-1");
    expect(logged[0]).toContain("Error");
    expect(logged[0]).not.toContain(ENDPOINT);
    expect(logged[0]).not.toContain(AUTH);

    // Isolation is unchanged: the 09:00 slot still went out.
    expect(pushSender.sentTo).toEqual([ENDPOINT]);
    expect(careOccurrenceRepo.all().find((o) => o.timeOfDay === "09:00")?.lastSendOutcome).toBe("sent");
  });

  it("when recording the failure ALSO fails, the round continues and the slot is left as an abandoned claim", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "08:55", repeatDays: [5] });
    careItemRepo.add({ id: "item-2", userId: "user-1" }, { id: "sched-2", timeOfDay: "09:00", repeatDays: [5] });
    await addRealisticSubscription("user-1");

    const recordAlwaysFails: CareOccurrenceRepository = {
      ...careOccurrenceRepo,
      getBySlot: careOccurrenceRepo.getBySlot.bind(careOccurrenceRepo),
      upsertBySlot: careOccurrenceRepo.upsertBySlot.bind(careOccurrenceRepo),
      claimAttempt: careOccurrenceRepo.claimAttempt.bind(careOccurrenceRepo),
      listPastUnlogged: careOccurrenceRepo.listPastUnlogged.bind(careOccurrenceRepo),
      listByUserAndDate: careOccurrenceRepo.listByUserAndDate.bind(careOccurrenceRepo),
      listPastUnloggedForUser: careOccurrenceRepo.listPastUnloggedForUser.bind(careOccurrenceRepo),
      expediteNoSubscriptionsRetry: careOccurrenceRepo.expediteNoSubscriptionsRetry.bind(careOccurrenceRepo),
      recordAttempt: async () => {
        throw new Error("neon 520");
      },
    };

    const error = captureConsole("error");
    try {
      await dispatchDueRounds(FRIDAY_0900_TAIPEI, "user-1", TAIPEI, {
        ...deps(),
        careOccurrenceRepo: recordAlwaysFails,
        pushSender: throwingSender(1),
      });
    } finally {
      error.restore();
    }

    // The 09:00 slot still ran (its own recordAttempt threw too, which is why
    // both slots below are abandoned claims rather than one).
    expect(pushSender.sentTo).toEqual([ENDPOINT]);
    const failed = careOccurrenceRepo.all().find((o) => o.timeOfDay === "08:55");
    expect(failed?.lastAttemptAt).not.toBeNull();
    expect(failed?.lastSendOutcome).toBeNull(); // an abandoned claim — section 7's short floor picks it up.
    // The ORIGINAL cause is what gets logged, not the recording write's own
    // failure that happened while reacting to it.
    const sched1Log = error.lines.filter((l) => l.includes("sched-1"));
    expect(sched1Log).toHaveLength(1);
    expect(sched1Log[0]).toContain("web push POST");
    expect(sched1Log[0]).not.toContain("neon 520");
  });
});

describe("an abandoned claim retries on a short floor, not the failed/nag floor (design.md D6)", () => {
  function seedAbandonedClaim(nagIntervalMinutes: number): void {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes });
    careOccurrenceRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      lastAttemptAt: FRIDAY_0900_TAIPEI, // claimed...
      lastSendOutcome: null, // ...and nothing was ever recorded.
    });
  }

  it("is due — and claimable — exactly two minutes after the attempt, whatever the nag interval says", async () => {
    seedAbandonedClaim(60);
    await addSubscription("user-1");

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 2 * 60_000), "user-1", TAIPEI, deps());

    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("is not due one second before that floor, so a round still in flight is not duplicated", async () => {
    seedAbandonedClaim(60);
    await addSubscription("user-1");

    await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 2 * 60_000 - 1000), "user-1", TAIPEI, deps());

    expect(pushSender.sentTo).toHaveLength(0);
  });

  it("planNextWake plans the retry for lastAttemptAt + 2 minutes, not the nag interval", () => {
    const schedule: CareSchedule = {
      careItemId: "item-1",
      id: "sched-1",
      timeOfDay: "09:00",
      repeatDays: [],
      weekInterval: 1,
      startDate: "2026-07-01",
      endDate: null,
      doseQuantity: 1,
      nagIntervalMinutes: 60,
      enabled: true,
    } as CareSchedule;
    const occurrence: CareOccurrence = {
      id: "occ-1",
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      lastNotifiedAt: null,
      lastAttemptAt: FRIDAY_0900_TAIPEI,
      lastSendOutcome: null,
      lastSendDetail: null,
    };

    const wake = planNextWake(FRIDAY_0900_TAIPEI, TAIPEI, "2026-07-24", [{ schedule, occurrence, answered: false }]);

    expect(wake).toEqual(new Date(FRIDAY_0900_TAIPEI.getTime() + 2 * 60_000));
  });

  for (const outcome of ["failed", "expired", "no_subscriptions"] as const) {
    it(`a recorded ${outcome} keeps the ten-minute floor: nothing at +2 minutes, dispatched at +10`, async () => {
      careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [5], nagIntervalMinutes: 0 });
      careOccurrenceRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-24",
        timeOfDay: "09:00",
        lastAttemptAt: FRIDAY_0900_TAIPEI,
        lastSendOutcome: outcome,
      });
      await addSubscription("user-1");

      await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 2 * 60_000), "user-1", TAIPEI, deps());
      expect(pushSender.sentTo).toHaveLength(0);

      await dispatchDueRounds(new Date(FRIDAY_0900_TAIPEI.getTime() + 10 * 60_000), "user-1", TAIPEI, deps());
      expect(pushSender.sentTo).toHaveLength(1);
    });
  }
});

describe("dispatchDueRounds: an orphaned occurrence from a same-day time change (design.md D7)", () => {
  // The measured case: the 16:15 schedule used to be 16:05, and the 16:05
  // occurrence was already materialized before the edit.
  const FRIDAY_1620_TAIPEI = new Date("2026-07-24T08:20:00Z");

  function seedOrphan(extra: Partial<Pick<CareOccurrence, "lastNotifiedAt" | "lastAttemptAt" | "lastSendOutcome">> = {}): void {
    careOccurrenceRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "16:05",
      ...extra,
    });
  }

  it("writes the abandoned old slot off as missed the same day", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "16:15", repeatDays: [5] });
    await addSubscription("user-1");
    seedOrphan();

    await dispatchDueRounds(FRIDAY_1620_TAIPEI, "user-1", TAIPEI, deps());

    expect(careLogRepo.statusOf("sched-1", "2026-07-24", "16:05")).toBe("missed");
    // The slot that IS active still dispatched normally.
    expect(pushSender.sentTo).toHaveLength(1);
  });

  it("never sends a push at the old time", async () => {
    // 23:00 is not due at 16:20, so any push at all would have to be the orphan's.
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "23:00", repeatDays: [5] });
    await addSubscription("user-1");
    seedOrphan();

    await dispatchDueRounds(FRIDAY_1620_TAIPEI, "user-1", TAIPEI, deps());

    expect(pushSender.sentTo).toEqual([]);
    expect(careLogRepo.statusOf("sched-1", "2026-07-24", "16:05")).toBe("missed");
  });

  it("leaves a delivered orphan alone for the ordinary end-of-day marking", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "16:15", repeatDays: [5] });
    await addSubscription("user-1");
    seedOrphan({ lastNotifiedAt: new Date("2026-07-24T08:05:00Z"), lastAttemptAt: new Date("2026-07-24T08:05:00Z"), lastSendOutcome: "sent" });

    await dispatchDueRounds(FRIDAY_1620_TAIPEI, "user-1", TAIPEI, deps());

    expect(careLogRepo.statusOf("sched-1", "2026-07-24", "16:05")).toBeUndefined();
  });

  it("never clobbers an answer the user already recorded for the orphaned slot", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "16:15", repeatDays: [5] });
    await addSubscription("user-1");
    seedOrphan();
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "16:05",
      status: "done",
      doneTime: new Date("2026-07-24T08:07:00Z"),
      doseQuantity: 1,
    });

    let upserts = 0;
    const countingLogRepo: CareLogRepository = {
      ...careLogRepo,
      getBySlot: careLogRepo.getBySlot.bind(careLogRepo),
      listByUserAndDate: careLogRepo.listByUserAndDate.bind(careLogRepo),
      listByUserAndDateRange: careLogRepo.listByUserAndDateRange.bind(careLogRepo),
      upsert: careLogRepo.upsert.bind(careLogRepo),
      upsertIfAbsent: (input: CreateCareLogInput) => {
        upserts++;
        return careLogRepo.upsertIfAbsent(input);
      },
    } as unknown as CareLogRepository;

    await dispatchDueRounds(FRIDAY_1620_TAIPEI, "user-1", TAIPEI, { ...deps(), careLogRepo: countingLogRepo });

    expect(careLogRepo.statusOf("sched-1", "2026-07-24", "16:05")).toBe("done");
    // ...and the answer is not merely *preserved* by `upsertIfAbsent`: the
    // round does not spend a subrequest on a slot it already has an answer for.
    expect(upserts).toBe(0);
  });

  it("is subject to the same budget check as a dispatch: an unaffordable retirement is deferred, not half-written", async () => {
    careItemRepo.add({ id: "item-1", userId: "user-1" }, { id: "sched-1", timeOfDay: "23:00", repeatDays: [5] });
    seedOrphan();

    const warn = captureConsole("warn");
    try {
      // Exactly the four round-setup reads and nothing left over.
      await withSubrequestBudget(4, () => dispatchDueRounds(FRIDAY_1620_TAIPEI, "user-1", TAIPEI, spendingDeps(deps())));
    } finally {
      warn.restore();
    }

    expect(careLogRepo.statusOf("sched-1", "2026-07-24", "16:05")).toBeUndefined();
    expect(warn.lines).toContain("care-dispatch: deferred 1 orphan retirements, subrequest budget exhausted");
  });
});
