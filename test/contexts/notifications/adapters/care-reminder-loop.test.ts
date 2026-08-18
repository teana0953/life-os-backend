import { describe, expect, it } from "vitest";
import { type CareReminderStep, runCareReminderDay } from "../../../../src/contexts/notifications/adapters/care-reminder-loop";
import { type RunCareDayDeps } from "../../../../src/contexts/notifications/application/run-care-day";
import { isActiveOn } from "../../../../src/contexts/notifications/domain/care-schedule";
import type {
  ActiveScheduleForUser,
  CareItem,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
} from "../../../../src/contexts/notifications/domain/care-item";
import type { CareLog, CareLogRepository, CreateCareLogInput } from "../../../../src/contexts/notifications/domain/care-log";
import type {
  CareOccurrence,
  CareOccurrenceRepository,
  ClaimAttemptInput,
  CreateCareOccurrenceInput,
  RecordAttemptInput,
} from "../../../../src/contexts/notifications/domain/care-occurrence";
import type { PushDeliveryRepository } from "../../../../src/contexts/notifications/domain/push-delivery";
import type { PushMessage, PushSendResult, PushSender } from "../../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository, PushSubscriptionKeys } from "../../../../src/contexts/notifications/domain/push-subscription";
import { StrictWorkflowStep } from "./strict-workflows-fakes";

// --- Minimal in-memory repos (same shapes/semantics as run-care-day.test.ts's,
// trimmed to only what this file's loop-level tests exercise). ---

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
  async listActiveSchedules(): ReturnType<CareItemRepository["listActiveSchedules"]> {
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

  private key(scheduleId: string, localDate: string, timeOfDay: string): string {
    return `${scheduleId}|${localDate}|${timeOfDay}`;
  }

  async upsertIfAbsent(input: CreateCareLogInput): Promise<{ log: CareLog; created: boolean }> {
    const key = this.key(input.careScheduleId, input.localDate, input.timeOfDay);
    const existing = this.bySlot.get(key);
    if (existing) return { log: existing, created: false };
    const log: CareLog = { id: `log-${this.bySlot.size + 1}`, ...input };
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
  async upsert(): Promise<{ log: CareLog; previousStatus: null }> {
    throw new Error("not used by these tests");
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

  /** Mirrors the real repository's leased-claim semantics (gate_decision #1) — no internal `await`, so it is atomic w.r.t. any interleaving `Promise.all` driver, exactly like a real DB's conditional UPDATE is atomic w.r.t. concurrent transactions. */
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

  async expediteNoSubscriptionsRetry(): Promise<void> {
    // Not used by these tests.
  }

  all(): CareOccurrence[] {
    return [...this.bySlot.values()];
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

class RecordingPushSender implements PushSender {
  sentTo: string[] = [];
  async send(subscription: PushSubscriptionKeys, _message: PushMessage): Promise<PushSendResult> {
    this.sentTo.push(subscription.endpoint);
    return { outcome: "sent" };
  }
}

const TAIPEI = "Asia/Taipei";
const USER = "user-1";
const LOCAL_DATE = "2026-08-12"; // a Wednesday.

function buildDeps() {
  const careItemRepo = new InMemoryCareItemRepository();
  const careLogRepo = new InMemoryCareLogRepository();
  const careOccurrenceRepo = new InMemoryCareOccurrenceRepository(careLogRepo);
  const subscriptionRepo = new InMemoryPushSubscriptionRepository();
  const pushSender = new RecordingPushSender();
  const pushDeliveryRepo: PushDeliveryRepository = { registerSent: async () => {}, markAcked: async () => false };
  const deps: RunCareDayDeps = { careItemRepo, careLogRepo, careOccurrenceRepo, subscriptionRepo, pushSender, pushDeliveryRepo };
  return { careItemRepo, careLogRepo, careOccurrenceRepo, subscriptionRepo, pushSender, deps };
}

/** Wraps a `StrictWorkflowStep`, recording every `sleep` call's name/duration for assertions. */
function recordingStep(strict: StrictWorkflowStep): { step: CareReminderStep; sleeps: { name: string; ms: number }[] } {
  const sleeps: { name: string; ms: number }[] = [];
  const step: CareReminderStep = {
    do: (name, cb) => strict.do(name, cb),
    sleep: async (name, ms) => {
      sleeps.push({ name, ms });
      await strict.sleep(name, ms);
    },
  };
  return { step, sleeps };
}

/**
 * Deliberate test-only stop signal, thrown once `dispatch-due-rounds` has
 * completed `n` times — this repo's `runCareReminderDay` never actually
 * terminates while its owning day's local date keeps rolling forward inside
 * these tests' minimal fakes (see `care-reminder-loop.ts`'s own not-in-scope
 * note in the final report), so a test that only cares about the first
 * round or two needs a deterministic place to stop that does NOT depend on
 * exactly how many steps it takes to reach the next local midnight.
 */
class TestStop extends Error {}

/** Like `recordingStep`, but throws `TestStop` right after the `n`th `dispatch-due-rounds` step completes (its effects, e.g. a push send, have already happened by then). */
function stepStoppingAfterDispatches(strict: StrictWorkflowStep, n: number): { step: CareReminderStep; sleeps: { name: string; ms: number }[] } {
  const sleeps: { name: string; ms: number }[] = [];
  let dispatches = 0;
  const step: CareReminderStep = {
    do: async (name, cb) => {
      const result = await strict.do(name, cb);
      if (name === "dispatch-due-rounds") {
        dispatches++;
        if (dispatches >= n) throw new TestStop();
      }
      return result;
    },
    sleep: async (name, ms) => {
      sleeps.push({ name, ms });
      await strict.sleep(name, ms);
    },
  };
  return { step, sleeps };
}

describe("runCareReminderDay — Bug A (sleepUntil crashing on an already-past wake instant)", () => {
  it("restart-grace: a slot within FIRST_FIRE_GRACE_MINUTES dispatches without any invalid (non-positive) sleep", async () => {
    const { careItemRepo, subscriptionRepo, pushSender, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });
    await subscriptionRepo.upsert({ userId: USER, endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    // 09:05 Taipei = 5 minutes late, within the 10-minute grace: this is
    // exactly the restartToday shape from Bug A (a slot just past due
    // when a fresh instance's very first plan-next-wake runs).
    const start = new Date("2026-08-12T01:05:00Z");
    const strict = new StrictWorkflowStep(start, 3000);
    const { step } = stepStoppingAfterDispatches(strict, 1); // stop right after round 1's dispatch.

    await expect(
      runCareReminderDay({ userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI }, step, deps, async () => {}, () => strict.now()),
    ).rejects.toThrow(TestStop);

    // The load-bearing assertion: it got FAR ENOUGH to actually dispatch the
    // grace-window slot — with Bug A's crash still present, the very first
    // round would throw "You can't sleep ... in the past" (surfaced here as
    // StrictWorkflowStep's non-positive-sleep rejection) instead.
    expect(pushSender.sentTo).toEqual(["https://push.example.com/a"]);
  });

  it("normal sleep: a not-yet-due slot uses a relative (positive-duration) sleep, not an absolute sleepUntil", async () => {
    const { careItemRepo, subscriptionRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });
    await subscriptionRepo.upsert({ userId: USER, endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    const start = new Date("2026-08-12T00:00:00Z"); // 08:00 Taipei — 1h before the 09:00 slot.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step, sleeps } = recordingStep(strict);

    // With the BLOCKER fix, this instance now genuinely terminates once
    // local midnight rolls past its own `localDate` — it no longer needs a
    // tight step budget to force an early stop, so just let it run to
    // completion.
    await runCareReminderDay({ userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI }, step, deps, async () => {}, () => strict.now());

    expect(sleeps[0]).toEqual({ name: "sleep-until-next-due", ms: 60 * 60_000 }); // exactly 1 hour, a relative duration.
    // An instance owning TODAY must never sleep in the day-start preamble —
    // the wait is 0 and `StrictWorkflowStep` would reject a 0ms sleep anyway.
    expect(sleeps.filter((s) => s.name === "sleep-until-day-start")).toEqual([]);
  });

  it("null exit: a null plan result breaks the loop without dispatching, and spawns the next care day", async () => {
    const { careItemRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] }); // fires daily — the next care day is tomorrow.
    const calls: string[] = [];
    const step: CareReminderStep = {
      do: async (name, cb) => {
        calls.push(name);
        if (name === "plan-next-wake") return null as never; // a legitimate possible value of this step's return type.
        return cb();
      },
      sleep: async () => {
        throw new Error("sleep must never be called when the plan step returns null");
      },
    };
    const spawned: string[] = [];

    // A FIXED injected clock, not the real one: 2026-08-13T00:00 Taipei, the
    // ordinary just-past-midnight instant at which a null plan legitimately
    // happens. The successor decision reads this clock, so leaving it on the
    // wall clock would make the assertion below drift with the real calendar.
    // This is also the normal (not-overdue) case pinned down: today is exactly
    // `localDate + 1`, so the successor must still be tomorrow.
    const at = () => new Date("2026-08-12T16:00:00Z");

    await runCareReminderDay(
      { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
      step,
      deps,
      async (tomorrow) => {
        spawned.push(tomorrow);
      },
      at,
    );

    // `plan-day-start-wait` runs (and returns 0, so no sleep) even for an
    // instance owning today; no dispatch-due-rounds, and no final-mark-missed
    // since the chain continues.
    expect(calls).toEqual(["mark-missed", "plan-day-start-wait", "plan-next-wake", "spawn-next-care-day"]);
    expect(spawned).toEqual(["2026-08-13"]);
  });

  it("busy loop budget: consecutive rounds with no state change fall back to the 5-minute floor and stay within the free-plan step budget's shape", async () => {
    const { careItemRepo, subscriptionRepo, pushSender, careOccurrenceRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });
    await subscriptionRepo.upsert({ userId: USER, endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    // A claim that never wins: no state ever advances (lastAttemptAt stays
    // null forever), so every round is genuinely immediate again — the
    // exact "persistent failure" shape gate_decision #2/risks_and_notes
    // describes as the only real cause of a no-progress streak.
    const alwaysLosesClaim: CareOccurrenceRepository = {
      ...careOccurrenceRepo,
      getBySlot: careOccurrenceRepo.getBySlot.bind(careOccurrenceRepo),
      upsertBySlot: careOccurrenceRepo.upsertBySlot.bind(careOccurrenceRepo),
      recordAttempt: careOccurrenceRepo.recordAttempt.bind(careOccurrenceRepo),
      listPastUnlogged: careOccurrenceRepo.listPastUnlogged.bind(careOccurrenceRepo),
      expediteNoSubscriptionsRetry: careOccurrenceRepo.expediteNoSubscriptionsRetry.bind(careOccurrenceRepo),
      claimAttempt: async () => false,
    };

    const start = new Date("2026-08-12T01:05:00Z"); // 09:05 Taipei, in grace.
    const strict = new StrictWorkflowStep(start, 3000); // the real free-plan ceiling.
    const { step, sleeps } = recordingStep(strict);
    const spawned: string[] = [];

    // With the BLOCKER fix, this instance genuinely terminates once local
    // midnight rolls past `localDate` — roughly (24h - 09:05) / 5min worth of
    // busy-loop-backoff rounds from `start` to midnight. The point of this
    // test is still HOW SLOWLY it burns budget while the claim never wins,
    // not whether it terminates at all.
    await runCareReminderDay(
      { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
      step,
      { ...deps, careOccurrenceRepo: alwaysLosesClaim },
      async (tomorrow) => {
        spawned.push(tomorrow);
      },
      () => strict.now(),
    );

    expect(spawned).toEqual(["2026-08-13"]); // it did reach and cross local midnight.
    expect(pushSender.sentTo).toHaveLength(0); // the claim never won — nothing was ever (or should ever be) sent.

    const backoffSleeps = sleeps.filter((s) => s.name === "busy-loop-backoff");
    expect(backoffSleeps.length).toBeGreaterThan(0); // the floor engaged...
    for (const s of backoffSleeps) expect(s.ms).toBe(5 * 60_000); // ...at exactly the 5-minute floor, every time.

    // 3 steps/round (plan, backoff-sleep, dispatch) once the floor engages —
    // matches the plan's ~288 rounds/day x 3 steps ≈ 900/day arithmetic: the
    // ~15 hours from 09:05 to midnight at the 5-minute floor is comfortably
    // within the free-plan's 3,000-step/day ceiling (well under 200 x 3).
    expect(backoffSleeps.length).toBeGreaterThan(150);
  });
});

describe("runCareReminderDay — BLOCKER: the loop must exit on ITS OWN owned local date rolling over, not a value re-derived from the same clock read planNextWake also uses", () => {
  it("does not exit before local midnight (dispatches the day's slot first), and exits + spawns tomorrow exactly once the real local date crosses midnight", async () => {
    const { careItemRepo, subscriptionRepo, pushSender, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });
    await subscriptionRepo.upsert({ userId: USER, endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    // Exactly 2026-08-12T00:00 Taipei — the very start of the instance's own
    // `localDate`. A real (unstubbed) clock, advanced only by real `sleep`
    // calls via StrictWorkflowStep — not a fake that jumps straight to a
    // pre-baked null.
    const start = new Date("2026-08-11T16:00:00Z");
    const strict = new StrictWorkflowStep(start, 3000);
    const calls: { name: string; atIso: string }[] = [];
    const step: CareReminderStep = {
      do: async (name, cb) => {
        const result = await strict.do(name, cb);
        calls.push({ name, atIso: strict.now().toISOString() });
        return result;
      },
      sleep: (name, ms) => strict.sleep(name, ms),
    };
    const spawned: string[] = [];

    await runCareReminderDay(
      { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
      step,
      deps,
      async (tomorrow) => {
        spawned.push(tomorrow);
      },
      () => strict.now(),
    );

    // Load-bearing: the 09:00 slot, still well within LOCAL_DATE, actually
    // got dispatched — an early-exit mutant (the more dangerous failure mode
    // per the review brief) would break the loop before this ever ran.
    expect(pushSender.sentTo).toEqual(["https://push.example.com/a"]);

    // Load-bearing: the loop DOES eventually terminate and spawn tomorrow
    // exactly once — an unreachable-exit mutant (the original blocker) would
    // instead busy-loop until StrictWorkflowStep's step-budget rejection
    // rejects the whole call, never resolving.
    expect(spawned).toEqual(["2026-08-13"]);
    expect(calls.filter((c) => c.name === "spawn-next-care-day")).toHaveLength(1);

    // The dispatch that answered the day's slot happened strictly before the
    // exit — ordering evidence against a too-eager exit slipping in front of
    // real same-day work.
    const dispatchIndex = calls.findIndex((c) => c.name === "dispatch-due-rounds");
    const spawnIndex = calls.findIndex((c) => c.name === "spawn-next-care-day");
    expect(dispatchIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeLessThan(spawnIndex);

    // The wake that finally exited genuinely landed on the next calendar day
    // in Taipei time, not merely some later instant still on LOCAL_DATE.
    const exitAt = calls[spawnIndex - 1]; // the plan-next-wake call immediately preceding the exit's spawn-next-care-day.
    expect(exitAt.name).toBe("plan-next-wake");
    expect(exitAt.atIso >= "2026-08-12T16:00:00.000Z").toBe(true); // >= 2026-08-13T00:00 Taipei.
  });
});

describe("runCareReminderDay — gate_decision #2: backoff must not delay a legitimate second immediate wake", () => {
  it("two slots both within grace at the same instant: the second is dispatched immediately, not after the 5-minute floor", async () => {
    const { careItemRepo, subscriptionRepo, pushSender, deps } = buildDeps();
    // Slot A exists from the start; slot B only becomes visible starting at
    // the 3rd call to listActiveSchedulesForUserOn (round 1's dispatch has
    // already run by then) — simulating a schedule the user creates via a
    // concurrent HTTP request WHILE this instance is mid-round, landing
    // between round 1's dispatch and round 2's plan (motivating example:
    // "16:02 建了排程、16:05 又建一個 16:00 的").
    // One subscription: push subscriptions are per-USER, not per-schedule, so
    // both schedules' rounds send to this same endpoint — the assertion below
    // counts SENDS (2, one per schedule), not distinct endpoints.
    careItemRepo.add({ id: "item-a", userId: USER }, { id: "sched-a", timeOfDay: "08:58", repeatDays: [] });
    await subscriptionRepo.upsert({ userId: USER, endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    let calls = 0;
    let bAdded = false;
    const growingCareItemRepo: CareItemRepository = {
      create: careItemRepo.create.bind(careItemRepo),
      get: careItemRepo.get.bind(careItemRepo),
      getByScheduleId: careItemRepo.getByScheduleId.bind(careItemRepo),
      update: careItemRepo.update.bind(careItemRepo),
      delete: careItemRepo.delete.bind(careItemRepo),
      decrementStock: careItemRepo.decrementStock.bind(careItemRepo),
      incrementStock: careItemRepo.incrementStock.bind(careItemRepo),
      listActiveSchedules: careItemRepo.listActiveSchedules.bind(careItemRepo),
      listByUser: careItemRepo.listByUser.bind(careItemRepo),
      listActiveSchedulesForUserOn: async (userId: string, localDate: string) => {
        calls++;
        if (calls >= 3 && !bAdded) {
          bAdded = true;
          careItemRepo.add({ id: "item-b", userId: USER }, { id: "sched-b", timeOfDay: "08:55", repeatDays: [] });
        }
        return careItemRepo.listActiveSchedulesForUserOn(userId, localDate);
      },
    };

    const start = new Date("2026-08-12T01:05:00Z"); // 09:05 Taipei — both 08:58 and 08:55 are within the 10-min grace.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step, sleeps } = stepStoppingAfterDispatches(strict, 2); // stop right after round 2's dispatch (B).

    await expect(
      runCareReminderDay(
        { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
        step,
        { ...deps, careItemRepo: growingCareItemRepo },
        async () => {},
        () => strict.now(),
      ),
    ).rejects.toThrow(TestStop);

    // Both slots got sent (one send per round, same user subscription) — and
    // crucially, NOT via a 5-minute-apart round: the busy-loop floor must
    // never have engaged, because round 1 (A) and round 2 (B) each
    // genuinely progressed state.
    expect(pushSender.sentTo).toEqual(["https://push.example.com/a", "https://push.example.com/a"]);
    expect(sleeps.filter((s) => s.name === "busy-loop-backoff")).toEqual([]);
  });
});

describe("runCareReminderDay — gate_decision #1: two instances racing the same user/day never double-send", () => {
  it("two concurrent runCareReminderDay loops over shared state each send a given slot at most once", async () => {
    const { careItemRepo, subscriptionRepo, pushSender, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });
    await subscriptionRepo.upsert({ userId: USER, endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    const start = new Date("2026-08-12T01:05:00Z"); // 09:05 Taipei, in grace — both instances see it as immediately due.
    const stepA = new StrictWorkflowStep(start, 3000);
    const stepB = new StrictWorkflowStep(start, 3000);

    // Both instances share the SAME `deps` (same underlying repos/pushSender)
    // — exactly the situation Bug B's fix (restartToday allowing multiple
    // concurrent instances) creates. `Promise.all` genuinely interleaves
    // them at every `await` boundary inside dispatchSlot (getBySlot,
    // upsertBySlot, claimAttempt, ...), unlike running them sequentially.
    // Each instance stops itself right after its own first
    // dispatch-due-rounds completes — the race that matters is entirely
    // within/around that first round.
    const results = await Promise.allSettled([
      runCareReminderDay(
        { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
        stepStoppingAfterDispatches(stepA, 1).step,
        deps,
        async () => {},
        () => stepA.now(),
      ),
      runCareReminderDay(
        { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
        stepStoppingAfterDispatches(stepB, 1).step,
        deps,
        async () => {},
        () => stepB.now(),
      ),
    ]);

    for (const r of results) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(TestStop);
    }

    expect(pushSender.sentTo).toEqual(["https://push.example.com/a"]); // exactly once, not twice.
  });
});

describe("runCareReminderDay — fix/idle-instance-chain: the chain jumps to the next day that actually has something scheduled", () => {
  it("a Monday-only user's midweek instance spawns the NEXT MONDAY, not tomorrow", async () => {
    const { careItemRepo, deps } = buildDeps();
    // repeatDays [1] = Mondays only. LOCAL_DATE is a Wednesday, so today has
    // no slot at all and the next firing day is 2026-08-17.
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [1] });

    const start = new Date("2026-08-11T16:00:00Z"); // 2026-08-12T00:00 Taipei.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step } = recordingStep(strict);
    const spawned: string[] = [];

    await runCareReminderDay(
      { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
      step,
      deps,
      async (next) => {
        spawned.push(next);
      },
      () => strict.now(),
    );

    // Load-bearing as an EQUALITY, not just "non-empty": the pre-fix
    // unconditional `nextLocalDate(localDate)` would spawn 2026-08-13 here,
    // and each of those five idle instances would spawn another.
    expect(spawned).toEqual(["2026-08-17"]);
  });

  it("a day with all slots already answered still spawns the next care day (answered-today is not no-slots)", async () => {
    const { careItemRepo, careLogRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });
    await careLogRepo.upsertIfAbsent({
      userId: USER,
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: LOCAL_DATE,
      timeOfDay: "09:00",
      status: "done",
      doneTime: null,
      doseQuantity: 1,
    });

    const start = new Date("2026-08-11T16:00:00Z"); // 2026-08-12T00:00 Taipei.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step } = recordingStep(strict);
    const spawned: string[] = [];

    await runCareReminderDay(
      { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
      step,
      deps,
      async (next) => {
        spawned.push(next);
      },
      () => strict.now(),
    );

    // Confusion guard: the successor decision reads the schedule calendar
    // only. A version that also asked "does today still have unanswered
    // slots" would end the chain here and silence tomorrow's reminders.
    expect(spawned).toEqual(["2026-08-13"]);
  });

  it("a user whose only schedule ends today spawns nothing AND marks today's unanswered slot missed itself", async () => {
    const { careItemRepo, careLogRepo, careOccurrenceRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [], endDate: LOCAL_DATE });
    // Today's slot was materialized but never answered. `mark-missed` at the
    // top of the run only covers days strictly BEFORE this instance's own —
    // with the chain ending here, nobody else will ever mark this one.
    await careOccurrenceRepo.upsertBySlot({
      userId: USER,
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: LOCAL_DATE,
      timeOfDay: "09:00",
    });

    const start = new Date("2026-08-12T15:50:00Z"); // 23:50 Taipei — 10 minutes before this instance's day ends.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step } = recordingStep(strict);
    const spawned: string[] = [];

    await runCareReminderDay(
      { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
      step,
      deps,
      async (next) => {
        spawned.push(next);
      },
      () => strict.now(),
    );

    expect(spawned).toEqual([]); // the chain terminates instead of seeding a permanently idle successor.
    const log = await careLogRepo.getBySlot("sched-1", LOCAL_DATE, "09:00");
    expect(log?.status).toBe("missed");
  });

  it("an instance created for a FUTURE care day sleeps until that day starts instead of exiting and spawning at once", async () => {
    const { careItemRepo, subscriptionRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] });
    await subscriptionRepo.upsert({ userId: USER, endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });

    const futureDate = "2026-08-15";
    const start = new Date("2026-08-12T01:05:00Z"); // 09:05 Taipei, three days early.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step, sleeps } = stepStoppingAfterDispatches(strict, 1); // stop at the first dispatch — which must happen ON 2026-08-15.
    const spawned: string[] = [];

    // Without the day-start wait this resolves instead of rejecting: the very
    // first plan-next-wake sees today !== 2026-08-15, exits, and spawns a
    // successor immediately — the unbounded same-instant cascade this guards.
    await expect(
      runCareReminderDay(
        { userId: USER, localDate: futureDate, timezone: TAIPEI },
        step,
        deps,
        async (next) => {
          spawned.push(next);
        },
        () => strict.now(),
      ),
    ).rejects.toThrow(TestStop);

    expect(sleeps[0]).toEqual({
      name: "sleep-until-day-start",
      ms: new Date("2026-08-14T16:00:00Z").getTime() - start.getTime(), // 2026-08-15T00:00 Taipei.
    });
    expect(spawned).toEqual([]); // nothing was spawned before its own day even began.
  });
});

describe("runCareReminderDay — fix/overdue-wake-jump: an overdue instance hands off to a day that is not already in the past", () => {
  it("an instance that wakes up 8 days late spawns TODAY, in one hop — not the day after its own localDate", async () => {
    const { careItemRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [] }); // fires daily.

    // The instance owns 2026-08-12 but only gets scheduled 8 days later —
    // the "Workflows了很久才醒" shape. Walking (anchoring the successor on
    // `localDate`) would spawn 2026-08-13, which is itself already overdue and
    // would spawn 2026-08-14, and so on: a hop per skipped day.
    const start = new Date("2026-08-20T02:00:00Z"); // 10:00 Taipei on 2026-08-20.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step, sleeps } = recordingStep(strict);
    const spawned: string[] = [];

    await runCareReminderDay(
      { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
      step,
      deps,
      async (next) => {
        spawned.push(next);
      },
      () => strict.now(),
    );

    // Load-bearing as an EQUALITY on the DATE, not just a hop count: the
    // successor is today itself (still able to fire today's remaining slots),
    // never tomorrow — anchoring on `today` instead of `previousLocalDate(today)`
    // would skip the whole of today and land on 2026-08-21.
    expect(spawned).toEqual(["2026-08-20"]);
    // One hop, and the overdue instance itself never slept: its own day is
    // long past, so it falls straight through to the hand-off.
    expect(sleeps).toEqual([]);
  });

  it("the successor of an overdue instance is never itself a past date (a Monday-only user 9 days late gets the NEXT Monday)", async () => {
    const { careItemRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [1] }); // Mondays only.

    // Owns Monday 2026-08-10; wakes on Wednesday 2026-08-19. The intervening
    // Monday 2026-08-17 is ALSO in the past — a fix that only jumped "to the
    // next care day after localDate" would spawn it, and that successor would
    // immediately exit and spawn again.
    const start = new Date("2026-08-19T02:00:00Z"); // 10:00 Taipei on Wednesday 2026-08-19.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step } = recordingStep(strict);
    const spawned: string[] = [];

    await runCareReminderDay(
      { userId: USER, localDate: "2026-08-10", timezone: TAIPEI },
      step,
      deps,
      async (next) => {
        spawned.push(next);
      },
      () => strict.now(),
    );

    // The next Monday at or after today — a FUTURE day the successor can
    // legitimately sleep until. Not 2026-08-17 (last Monday, already past).
    expect(spawned).toEqual(["2026-08-24"]);
  });

  it("an overdue instance whose chain has ended still marks the jumped-over days' unanswered slots missed", async () => {
    const { careItemRepo, careLogRepo, careOccurrenceRepo, deps } = buildDeps();
    careItemRepo.add({ id: "item-1", userId: USER }, { id: "sched-1", timeOfDay: "09:00", repeatDays: [], endDate: "2026-08-13" });
    // A slot on 2026-08-13 — AFTER this instance's own `localDate`, inside the
    // jumped-over window (a transitional instance could have materialized it).
    // The top-of-run `mark-missed` covers only `< localDate`, so with the chain
    // ending here this instance's final sweep is the only thing that can ever
    // reach it.
    await careOccurrenceRepo.upsertBySlot({
      userId: USER,
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-08-13",
      timeOfDay: "09:00",
    });

    const start = new Date("2026-08-20T02:00:00Z"); // 10:00 Taipei, a week past the schedule's end.
    const strict = new StrictWorkflowStep(start, 3000);
    const { step } = recordingStep(strict);
    const spawned: string[] = [];

    await runCareReminderDay(
      { userId: USER, localDate: LOCAL_DATE, timezone: TAIPEI },
      step,
      deps,
      async (next) => {
        spawned.push(next);
      },
      () => strict.now(),
    );

    expect(spawned).toEqual([]); // nothing scheduled at or after today — the chain really is over.
    // Anchoring the final sweep on `localDate` instead of today would stop at
    // 2026-08-13 exclusive and lose this one forever.
    const log = await careLogRepo.getBySlot("sched-1", "2026-08-13", "09:00");
    expect(log?.status).toBe("missed");
  });
});
