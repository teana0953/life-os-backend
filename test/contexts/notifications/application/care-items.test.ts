import { beforeEach, describe, expect, it } from "vitest";
import {
  createCareItem,
  deleteCareItem,
  InvalidCareItemError,
  listCareItems,
  updateCareItem,
} from "../../../../src/contexts/notifications/application/care-items";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareCategory,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
  CareScheduleInput,
  CreateCareItemInput,
  UpdateCareItemPatch,
} from "../../../../src/contexts/notifications/domain/care-item";

class InMemoryCareItemRepository implements CareItemRepository {
  private byId = new Map<string, CareItemWithSchedules>();
  private nextId = 1;
  private nextScheduleId = 1;

  private scheduleInputToSchedule(careItemId: string, input: CareScheduleInput): CareSchedule {
    return {
      id: input.id ?? `sched-${this.nextScheduleId++}`,
      careItemId,
      timeOfDay: input.timeOfDay,
      repeatDays: input.repeatDays,
      weekInterval: input.weekInterval,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      doseQuantity: input.doseQuantity,
      nagIntervalMinutes: input.nagIntervalMinutes,
      enabled: input.enabled,
    };
  }

  async create(input: CreateCareItemInput): Promise<CareItemWithSchedules> {
    const id = `item-${this.nextId++}`;
    const item: CareItemWithSchedules = {
      id,
      userId: input.userId,
      category: input.category,
      title: input.title,
      note: input.note ?? null,
      dose: input.dose ?? null,
      stock: input.stock ?? null,
      stockAlert: input.stockAlert ?? null,
      schedules: input.schedules.map((s) => this.scheduleInputToSchedule(id, s)),
    };
    this.byId.set(id, item);
    return item;
  }

  async listByUser(userId: string, category?: CareCategory): Promise<CareItemWithSchedules[]> {
    return [...this.byId.values()].filter((i) => i.userId === userId && (!category || i.category === category));
  }

  async get(id: string): Promise<CareItemWithSchedules | null> {
    return this.byId.get(id) ?? null;
  }

  async getByScheduleId(scheduleId: string): Promise<CareItemWithSchedules | null> {
    for (const item of this.byId.values()) {
      if (item.schedules.some((s) => s.id === scheduleId)) return item;
    }
    return null;
  }

  async update(id: string, userId: string, patch: UpdateCareItemPatch): Promise<CareItemWithSchedules | null> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return null;
    // Mirrors DrizzleCareItemRepository.update: a patch schedule id only
    // matches an EXISTING row for this item (update in place); a stale/foreign
    // or absent id is treated as new (inserted with a fresh id), never dropped.
    const existingIds = new Set(existing.schedules.map((s) => s.id));
    const updated: CareItemWithSchedules = {
      ...existing,
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.dose !== undefined ? { dose: patch.dose } : {}),
      ...(patch.stock !== undefined ? { stock: patch.stock } : {}),
      ...(patch.stockAlert !== undefined ? { stockAlert: patch.stockAlert } : {}),
      schedules:
        patch.schedules !== undefined
          ? patch.schedules.map((s) =>
              s.id && existingIds.has(s.id) ? this.scheduleInputToSchedule(id, s) : this.scheduleInputToSchedule(id, { ...s, id: undefined }),
            )
          : existing.schedules,
    };
    this.byId.set(id, updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return false;
    this.byId.delete(id);
    return true;
  }

  async listActiveSchedules(): Promise<ActiveCareSchedule[]> {
    throw new Error("not used by these tests");
  }

  async listActiveSchedulesForUserOn(): Promise<ActiveScheduleForUser[]> {
    throw new Error("not used by these tests");
  }

  async decrementStock(): Promise<void> {
    throw new Error("not used by these tests");
  }
}

const VALID_SCHEDULE: CareScheduleInput = {
  timeOfDay: "08:00",
  repeatDays: [1, 3, 5],
  weekInterval: 1,
  startDate: "2026-07-01",
  endDate: null,
  doseQuantity: 1,
  nagIntervalMinutes: 15,
  enabled: true,
};

const VALID_INPUT: CreateCareItemInput = {
  userId: "user-1",
  category: "medication",
  title: "降血壓藥",
  note: null,
  dose: "5mg",
  stock: 30,
  stockAlert: 5,
  schedules: [VALID_SCHEDULE],
};

let repo: InMemoryCareItemRepository;

beforeEach(() => {
  repo = new InMemoryCareItemRepository();
});

describe("createCareItem", () => {
  it("creates and stores a care item with its schedules", async () => {
    const created = await createCareItem(repo, VALID_INPUT);

    expect(created).toMatchObject({
      category: "medication",
      title: "降血壓藥",
      dose: "5mg",
      stock: 30,
      stockAlert: 5,
    });
    expect(created.schedules).toHaveLength(1);
    expect(created.schedules[0]).toMatchObject({ timeOfDay: "08:00", repeatDays: [1, 3, 5] });
  });

  it("creates a rehab reminder with a note and no dose/stock", async () => {
    const created = await createCareItem(repo, {
      ...VALID_INPUT,
      category: "rehab",
      dose: undefined,
      stock: undefined,
      stockAlert: undefined,
      note: "每天伸展 15 分鐘",
    });

    expect(created).toMatchObject({ category: "rehab", note: "每天伸展 15 分鐘", dose: null, stock: null });
  });

  it("rejects an unknown category", async () => {
    await expect(createCareItem(repo, { ...VALID_INPUT, category: "unknown" as never })).rejects.toBeInstanceOf(
      InvalidCareItemError,
    );
  });

  it("rejects a schedule with a time_of_day that is not HH:mm", async () => {
    await expect(
      createCareItem(repo, { ...VALID_INPUT, schedules: [{ ...VALID_SCHEDULE, timeOfDay: "8:00" }] }),
    ).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("allows an empty repeat_days (every day)", async () => {
    const created = await createCareItem(repo, {
      ...VALID_INPUT,
      schedules: [{ ...VALID_SCHEDULE, repeatDays: [] }],
    });
    expect(created.schedules[0].repeatDays).toEqual([]);
  });

  it("rejects a repeat_days entry outside 0-6", async () => {
    await expect(
      createCareItem(repo, { ...VALID_INPUT, schedules: [{ ...VALID_SCHEDULE, repeatDays: [7] }] }),
    ).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("rejects a week_interval below 1", async () => {
    await expect(
      createCareItem(repo, { ...VALID_INPUT, schedules: [{ ...VALID_SCHEDULE, weekInterval: 0 }] }),
    ).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("rejects a start_date that is not a real date", async () => {
    await expect(
      createCareItem(repo, { ...VALID_INPUT, schedules: [{ ...VALID_SCHEDULE, startDate: "2026-02-30" }] }),
    ).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("rejects an end_date before start_date", async () => {
    await expect(
      createCareItem(repo, {
        ...VALID_INPUT,
        schedules: [{ ...VALID_SCHEDULE, startDate: "2026-07-10", endDate: "2026-07-01" }],
      }),
    ).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("rejects a negative nag_interval_minutes", async () => {
    await expect(
      createCareItem(repo, { ...VALID_INPUT, schedules: [{ ...VALID_SCHEDULE, nagIntervalMinutes: -1 }] }),
    ).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("accepts nag_interval_minutes of 0", async () => {
    const created = await createCareItem(repo, {
      ...VALID_INPUT,
      schedules: [{ ...VALID_SCHEDULE, nagIntervalMinutes: 0 }],
    });
    expect(created.schedules[0].nagIntervalMinutes).toBe(0);
  });

  it("rejects a dose_quantity below 1", async () => {
    await expect(
      createCareItem(repo, { ...VALID_INPUT, schedules: [{ ...VALID_SCHEDULE, doseQuantity: 0 }] }),
    ).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("rejects a negative stock", async () => {
    await expect(createCareItem(repo, { ...VALID_INPUT, stock: -1 })).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("rejects a negative stock_alert", async () => {
    await expect(createCareItem(repo, { ...VALID_INPUT, stockAlert: -1 })).rejects.toBeInstanceOf(
      InvalidCareItemError,
    );
  });
});

describe("listCareItems", () => {
  it("returns only the caller's items", async () => {
    await createCareItem(repo, VALID_INPUT);
    await createCareItem(repo, { ...VALID_INPUT, userId: "user-2" });

    const list = await listCareItems(repo, "user-1");

    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe("user-1");
  });

  it("filters by category when given", async () => {
    await createCareItem(repo, { ...VALID_INPUT, category: "medication" });
    await createCareItem(repo, { ...VALID_INPUT, category: "rehab", dose: undefined, stock: undefined, stockAlert: undefined });

    const list = await listCareItems(repo, "user-1", "rehab");

    expect(list).toHaveLength(1);
    expect(list[0].category).toBe("rehab");
  });
});

describe("updateCareItem", () => {
  it("updates only the given item fields", async () => {
    const created = await createCareItem(repo, VALID_INPUT);

    const updated = await updateCareItem(repo, created.id, "user-1", { title: "新標題" });

    expect(updated).toMatchObject({ title: "新標題", dose: "5mg" });
  });

  it("upserts schedules by id: an existing id updates in place, no id inserts", async () => {
    const created = await createCareItem(repo, VALID_INPUT);
    const existingScheduleId = created.schedules[0].id;

    const updated = await updateCareItem(repo, created.id, "user-1", {
      schedules: [
        { id: existingScheduleId, ...VALID_SCHEDULE, timeOfDay: "09:00" },
        { ...VALID_SCHEDULE, timeOfDay: "20:00" },
      ],
    });

    expect(updated?.schedules).toHaveLength(2);
    expect(updated?.schedules.find((s) => s.id === existingScheduleId)?.timeOfDay).toBe("09:00");
  });

  it("a patch schedule with an unknown id is inserted as new, not dropped", async () => {
    const created = await createCareItem(repo, VALID_INPUT);
    const existingScheduleId = created.schedules[0].id;

    const updated = await updateCareItem(repo, created.id, "user-1", {
      schedules: [{ id: "stale-or-foreign-id", ...VALID_SCHEDULE, timeOfDay: "20:00" }],
    });

    // The unknown-id schedule was inserted (not silently dropped) under a fresh id...
    expect(updated?.schedules).toHaveLength(1);
    expect(updated?.schedules[0].id).not.toBe("stale-or-foreign-id");
    expect(updated?.schedules[0].timeOfDay).toBe("20:00");
    // ...and the previously-existing schedule, omitted by this patch, was deleted.
    expect(updated?.schedules.some((s) => s.id === existingScheduleId)).toBe(false);
  });

  it("omitting schedules leaves them unchanged", async () => {
    const created = await createCareItem(repo, VALID_INPUT);

    const updated = await updateCareItem(repo, created.id, "user-1", { title: "新標題" });

    expect(updated?.schedules).toEqual(created.schedules);
  });

  it("validates a provided schedule field just as create does", async () => {
    const created = await createCareItem(repo, VALID_INPUT);

    await expect(
      updateCareItem(repo, created.id, "user-1", { schedules: [{ ...VALID_SCHEDULE, timeOfDay: "not-a-time" }] }),
    ).rejects.toBeInstanceOf(InvalidCareItemError);
  });

  it("does not affect an item not owned by the caller", async () => {
    const created = await createCareItem(repo, VALID_INPUT);

    const result = await updateCareItem(repo, created.id, "someone-else", { title: "新標題" });

    expect(result).toBeNull();
    expect((await repo.get(created.id))?.title).toBe(VALID_INPUT.title);
  });
});

describe("deleteCareItem", () => {
  it("deletes an owned item", async () => {
    const created = await createCareItem(repo, VALID_INPUT);

    const deleted = await deleteCareItem(repo, created.id, "user-1");

    expect(deleted).toBe(true);
    expect(await repo.get(created.id)).toBeNull();
  });

  it("does not delete an item not owned by the caller", async () => {
    const created = await createCareItem(repo, VALID_INPUT);

    const deleted = await deleteCareItem(repo, created.id, "someone-else");

    expect(deleted).toBe(false);
    expect(await repo.get(created.id)).not.toBeNull();
  });
});
