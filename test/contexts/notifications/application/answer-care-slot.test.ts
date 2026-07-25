import { beforeEach, describe, expect, it } from "vitest";
import { answerCareSlot } from "../../../../src/contexts/notifications/application/answer-care-slot";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
} from "../../../../src/contexts/notifications/domain/care-item";
import type { CareLog, CareLogRepository, CreateCareLogInput } from "../../../../src/contexts/notifications/domain/care-log";

class FakeCareItemRepository implements CareItemRepository {
  items = new Map<string, CareItemWithSchedules>();
  decrementCalls: { itemId: string; amount: number }[] = [];

  add(item: CareItemWithSchedules): void {
    this.items.set(item.id, item);
  }

  async create(): Promise<CareItemWithSchedules> {
    throw new Error("not used by these tests");
  }
  async listByUser(): Promise<CareItemWithSchedules[]> {
    throw new Error("not used by these tests");
  }
  async get(id: string): Promise<CareItemWithSchedules | null> {
    return this.items.get(id) ?? null;
  }
  async getByScheduleId(scheduleId: string): Promise<CareItemWithSchedules | null> {
    for (const item of this.items.values()) {
      if (item.schedules.some((s) => s.id === scheduleId)) return item;
    }
    return null;
  }
  async update(): Promise<CareItemWithSchedules | null> {
    throw new Error("not used by these tests");
  }
  async delete(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
  async listActiveSchedules(): Promise<ActiveCareSchedule[]> {
    throw new Error("not used by these tests");
  }
  async listActiveSchedulesForUserOn(): Promise<ActiveScheduleForUser[]> {
    throw new Error("not used by these tests");
  }
  async decrementStock(itemId: string, amount: number): Promise<void> {
    this.decrementCalls.push({ itemId, amount });
    const item = this.items.get(itemId);
    if (item && item.stock !== null) item.stock = Math.max(0, item.stock - amount);
  }
  async incrementStock(): Promise<void> {
    throw new Error("not used by these tests");
  }
}

class FakeCareLogRepository implements CareLogRepository {
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
  async upsert(): Promise<{ log: CareLog; previousStatus: CareLog["status"] | null }> {
    throw new Error("not used by these tests");
  }
}

function makeSchedule(overrides: Partial<CareSchedule> = {}): CareSchedule {
  return {
    id: "sched-1",
    careItemId: "item-1",
    timeOfDay: "08:00",
    repeatDays: [],
    weekInterval: 1,
    startDate: "2026-07-01",
    endDate: null,
    doseQuantity: 2,
    nagIntervalMinutes: 15,
    enabled: true,
    ...overrides,
  };
}

function makeItem(overrides: Partial<CareItemWithSchedules> = {}): CareItemWithSchedules {
  return {
    id: "item-1",
    userId: "user-1",
    category: "medication",
    title: "藥物",
    note: null,
    dose: "5mg",
    stock: 10,
    stockAlert: 2,
    schedules: [makeSchedule()],
    ...overrides,
  };
}

let careItemRepo: FakeCareItemRepository;
let careLogRepo: FakeCareLogRepository;

beforeEach(() => {
  careItemRepo = new FakeCareItemRepository();
  careLogRepo = new FakeCareLogRepository();
});

const SLOT = { careScheduleId: "sched-1", localDate: "2026-07-24", timeOfDay: "08:00" } as const;

describe("answerCareSlot", () => {
  it("returns null when the schedule is not owned by the caller", async () => {
    careItemRepo.add(makeItem());

    const result = await answerCareSlot({ careItemRepo, careLogRepo }, "someone-else", { ...SLOT, status: "done" });

    expect(result).toBeNull();
  });

  it("records a done log and stops the nag (the log exists for the slot)", async () => {
    careItemRepo.add(makeItem());

    const log = await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(log).toMatchObject({ status: "done", careScheduleId: "sched-1", localDate: "2026-07-24", timeOfDay: "08:00" });
    expect(await careLogRepo.getBySlot("sched-1", "2026-07-24", "08:00")).not.toBeNull();
  });

  it("a first done on a medication item with tracked stock decrements it by dose_quantity", async () => {
    careItemRepo.add(makeItem({ stock: 10, schedules: [makeSchedule({ doseQuantity: 3 })] }));

    await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toEqual([{ itemId: "item-1", amount: 3 }]);
  });

  it("a second done for the same slot does NOT decrement again (no-op returning the existing log)", async () => {
    careItemRepo.add(makeItem({ stock: 10, schedules: [makeSchedule({ doseQuantity: 3 })] }));

    const first = await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });
    const second = await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("a re-answer with a different status is a no-op returning the existing log unchanged", async () => {
    careItemRepo.add(makeItem());

    const first = await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });
    const second = await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "skipped" });

    expect(second?.status).toBe("done");
    expect(second).toEqual(first);
  });

  it("a non-medication item's done touches no stock", async () => {
    careItemRepo.add(
      makeItem({ category: "rehab", dose: null, stock: null, note: "伸展", schedules: [makeSchedule({ doseQuantity: 1 })] }),
    );

    await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toHaveLength(0);
  });

  it("a medication item with stock=null (untracked) touches no stock on done", async () => {
    careItemRepo.add(makeItem({ stock: null }));

    await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toHaveLength(0);
  });

  it("skipped changes no stock", async () => {
    careItemRepo.add(makeItem());

    await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "skipped" });

    expect(careItemRepo.decrementCalls).toHaveLength(0);
  });

  it("stock decrement clamps at 0", async () => {
    careItemRepo.add(makeItem({ stock: 2, schedules: [makeSchedule({ doseQuantity: 5 })] }));

    await answerCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.items.get("item-1")?.stock).toBe(0);
  });
});
