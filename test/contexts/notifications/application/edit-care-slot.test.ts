import { beforeEach, describe, expect, it } from "vitest";
import { editCareSlot } from "../../../../src/contexts/notifications/application/edit-care-slot";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
} from "../../../../src/contexts/notifications/domain/care-item";
import type { CareLog, CareLogRepository, CareLogStatus, CreateCareLogInput } from "../../../../src/contexts/notifications/domain/care-log";

class FakeCareItemRepository implements CareItemRepository {
  items = new Map<string, CareItemWithSchedules>();
  decrementCalls: { itemId: string; amount: number }[] = [];
  incrementCalls: { itemId: string; amount: number }[] = [];

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
  async incrementStock(itemId: string, amount: number): Promise<void> {
    this.incrementCalls.push({ itemId, amount });
    const item = this.items.get(itemId);
    if (item && item.stock !== null) item.stock = item.stock + amount;
  }
}

class FakeCareLogRepository implements CareLogRepository {
  private bySlot = new Map<string, CareLog>();
  private nextId = 1;
  getBySlotCalls = 0;

  private key(scheduleId: string, localDate: string, timeOfDay: string): string {
    return `${scheduleId}|${localDate}|${timeOfDay}`;
  }

  /** Test helper: seed a pre-existing log for the slot (a prior POST/PUT answer). */
  seed(input: CreateCareLogInput): void {
    this.bySlot.set(this.key(input.careScheduleId, input.localDate, input.timeOfDay), {
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

  async upsertIfAbsent(): Promise<{ log: CareLog; created: boolean }> {
    throw new Error("not used by these tests");
  }
  async getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareLog | null> {
    this.getBySlotCalls++;
    return this.bySlot.get(this.key(careScheduleId, localDate, timeOfDay)) ?? null;
  }
  async listByUserAndDate(): Promise<CareLog[]> {
    throw new Error("not used by these tests");
  }
  async listByUserAndDateRange(): Promise<CareLog[]> {
    throw new Error("not used by these tests");
  }
  async upsert(input: CreateCareLogInput): Promise<{ log: CareLog; previousStatus: CareLogStatus | null }> {
    const key = this.key(input.careScheduleId, input.localDate, input.timeOfDay);
    const existing = this.bySlot.get(key);
    const log: CareLog = {
      id: existing?.id ?? `log-${this.nextId++}`,
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
    return { log, previousStatus: existing?.status ?? null };
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

const SLOT = { careScheduleId: "sched-1", localDate: "2026-07-20", timeOfDay: "08:00" } as const;

describe("editCareSlot", () => {
  it("returns null when the schedule is not owned by the caller", async () => {
    careItemRepo.add(makeItem());

    const result = await editCareSlot({ careItemRepo, careLogRepo }, "someone-else", { ...SLOT, status: "done" });

    expect(result).toBeNull();
  });

  it("overwrites an existing log's status (unlike POST's insert-if-absent)", async () => {
    careItemRepo.add(makeItem());
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "done",
      doneTime: new Date("2026-07-20T01:00:00Z"),
      doseQuantity: 2,
    });

    const result = await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "skipped" });

    expect(result?.status).toBe("skipped");
    expect((await careLogRepo.getBySlot("sched-1", SLOT.localDate, SLOT.timeOfDay))?.status).toBe("skipped");
  });

  it("not-done -> done decrements stock by dose_quantity (no prior log)", async () => {
    careItemRepo.add(makeItem({ stock: 10, schedules: [makeSchedule({ doseQuantity: 3 })] }));

    await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toEqual([{ itemId: "item-1", amount: 3 }]);
    expect(careItemRepo.incrementCalls).toHaveLength(0);
  });

  it("done -> skipped (edit) increments stock back by dose_quantity", async () => {
    careItemRepo.add(makeItem({ stock: 7, schedules: [makeSchedule({ doseQuantity: 3 })] }));
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "done",
      doneTime: new Date("2026-07-20T01:00:00Z"),
      doseQuantity: 3,
    });

    await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "skipped" });

    expect(careItemRepo.incrementCalls).toEqual([{ itemId: "item-1", amount: 3 }]);
    expect(careItemRepo.decrementCalls).toHaveLength(0);
    expect(careItemRepo.items.get("item-1")?.stock).toBe(10);
  });

  it("skipped -> done (no prior log) decrements stock", async () => {
    careItemRepo.add(makeItem({ stock: 10, schedules: [makeSchedule({ doseQuantity: 3 })] }));
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "skipped",
      doneTime: null,
      doseQuantity: 3,
    });

    await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toEqual([{ itemId: "item-1", amount: 3 }]);
  });

  it("done -> done (re-edit, no status change) touches no stock", async () => {
    careItemRepo.add(makeItem({ stock: 10, schedules: [makeSchedule({ doseQuantity: 3 })] }));
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "done",
      doneTime: new Date("2026-07-20T01:00:00Z"),
      doseQuantity: 3,
    });

    await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toHaveLength(0);
    expect(careItemRepo.incrementCalls).toHaveLength(0);
  });

  it("skipped -> skipped (re-edit, no status change) touches no stock", async () => {
    careItemRepo.add(makeItem({ stock: 10, schedules: [makeSchedule({ doseQuantity: 3 })] }));
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "skipped",
      doneTime: null,
      doseQuantity: 3,
    });

    await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "skipped" });

    expect(careItemRepo.decrementCalls).toHaveLength(0);
    expect(careItemRepo.incrementCalls).toHaveLength(0);
  });

  it("a non-medication item's edit touches no stock even when transitioning to done", async () => {
    careItemRepo.add(
      makeItem({ category: "rehab", dose: null, stock: null, note: "伸展", schedules: [makeSchedule({ doseQuantity: 1 })] }),
    );

    await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toHaveLength(0);
    expect(careItemRepo.incrementCalls).toHaveLength(0);
  });

  it("a medication item with stock=null (untracked) touches no stock", async () => {
    careItemRepo.add(makeItem({ stock: null }));

    await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(careItemRepo.decrementCalls).toHaveLength(0);
    expect(careItemRepo.incrementCalls).toHaveLength(0);
  });

  it("PIN: a decrement clamped to 0 then undone (done -> skipped) restores the FULL dose, not just what was clamped-off (existing asymmetric semantics, not a bug)", async () => {
    // Stock is 2, dose is 5: the first done clamps stock to 0 (only 2 actually removed).
    careItemRepo.add(makeItem({ stock: 2, schedules: [makeSchedule({ doseQuantity: 5 })] }));
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "done",
      doneTime: new Date("2026-07-20T01:00:00Z"),
      doseQuantity: 5,
    });
    // Simulate that this "done" log was created via a clamped decrement: apply it now.
    await careItemRepo.decrementStock("item-1", 5);
    expect(careItemRepo.items.get("item-1")?.stock).toBe(0);

    await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "skipped" });

    // Undo increments the full dose (5), landing at 5 -- higher than the original 2.
    expect(careItemRepo.items.get("item-1")?.stock).toBe(5);
  });

  it("status: done + doneTime supplied -> the supplied value is recorded (not now), with no extra getBySlot read", async () => {
    careItemRepo.add(makeItem());
    const suppliedTime = new Date("2026-07-20T13:30:00Z");

    const result = await editCareSlot({ careItemRepo, careLogRepo }, "user-1", {
      ...SLOT,
      status: "done",
      doneTime: suppliedTime,
    });

    expect(result?.doneTime).toEqual(suppliedTime);
    expect(careLogRepo.getBySlotCalls).toBe(0);
  });

  it("status: done + no doneTime + existing log already done -> the existing doneTime is preserved (not overwritten with now)", async () => {
    careItemRepo.add(makeItem());
    const existingDoneTime = new Date("2026-07-20T01:00:00Z");
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "done",
      doneTime: existingDoneTime,
      doseQuantity: 2,
    });

    const result = await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    expect(result?.doneTime).toEqual(existingDoneTime);
    expect(careLogRepo.getBySlotCalls).toBe(1);
  });

  // "Preserve" is keyed on there being something to preserve, not just on the
  // status: a done row with a NULL completion time must get one stamped on.
  // Keeping that NULL would write back `status: done` with no completion time
  // — the shape this branch exists to keep out of the data. No current writer
  // can produce such a row, so this guards legacy/imported data.
  it("status: done + no doneTime + existing log is done but has a NULL doneTime -> stamps now (does not preserve the null)", async () => {
    careItemRepo.add(makeItem());
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "done",
      doneTime: null,
      doseQuantity: 2,
    });
    const before = Date.now();

    const result = await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    const after = Date.now();
    expect(result?.doneTime).not.toBeNull();
    expect(result!.doneTime!.getTime()).toBeGreaterThanOrEqual(before);
    expect(result!.doneTime!.getTime()).toBeLessThanOrEqual(after);
  });

  // The other half of the same row: a log EXISTS but wasn't done. "Preserve
  // the existing value" must not apply here — inheriting a skipped/missed
  // row's null would write `status: done` with no completion time, which is
  // the very shape this change exists to keep out of the data. Without this
  // case the `=== "done"` half of the guard is unprotected.
  it("status: done + no doneTime + existing log is NOT done -> falls back to now (never inherits that row's null)", async () => {
    careItemRepo.add(makeItem());
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "skipped",
      doneTime: null,
      doseQuantity: 2,
    });
    const before = Date.now();

    const result = await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    const after = Date.now();
    expect(result?.doneTime).not.toBeNull();
    expect(result!.doneTime!.getTime()).toBeGreaterThanOrEqual(before);
    expect(result!.doneTime!.getTime()).toBeLessThanOrEqual(after);
    expect(careLogRepo.getBySlotCalls).toBe(1);
  });

  it("status: done + no doneTime + no prior log -> falls back to now (unchanged behaviour)", async () => {
    careItemRepo.add(makeItem());
    const before = Date.now();

    const result = await editCareSlot({ careItemRepo, careLogRepo }, "user-1", { ...SLOT, status: "done" });

    const after = Date.now();
    expect(result?.doneTime).not.toBeNull();
    expect(result!.doneTime!.getTime()).toBeGreaterThanOrEqual(before);
    expect(result!.doneTime!.getTime()).toBeLessThanOrEqual(after);
    expect(careLogRepo.getBySlotCalls).toBe(1);
  });

  it("status: skipped + doneTime supplied -> doneTime is recorded as null (ignored, not an error), with no extra getBySlot read", async () => {
    careItemRepo.add(makeItem());
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: SLOT.localDate,
      timeOfDay: SLOT.timeOfDay,
      status: "done",
      doneTime: new Date("2026-07-20T01:00:00Z"),
      doseQuantity: 2,
    });

    const result = await editCareSlot({ careItemRepo, careLogRepo }, "user-1", {
      ...SLOT,
      status: "skipped",
      doneTime: new Date("2026-07-20T21:30:00Z"),
    });

    expect(result?.doneTime).toBeNull();
    expect(careLogRepo.getBySlotCalls).toBe(0);
  });
});
