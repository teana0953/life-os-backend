import { describe, expect, it } from "vitest";
import { getCareAdherence } from "../../../../src/contexts/notifications/application/get-care-adherence";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareCategory,
  CareItem,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
} from "../../../../src/contexts/notifications/domain/care-item";
import type { CareLog, CareLogRepository, CreateCareLogInput } from "../../../../src/contexts/notifications/domain/care-log";

class FakeCareItemRepository implements CareItemRepository {
  private items: CareItemWithSchedules[] = [];

  add(item: Partial<CareItem> & { schedules: CareSchedule[] }): void {
    const fullItem: CareItemWithSchedules = {
      id: "item-1",
      userId: "user-1",
      category: "medication" as CareCategory,
      title: "藥物",
      note: null,
      dose: null,
      stock: null,
      stockAlert: null,
      ...item,
    };
    this.items.push(fullItem);
  }

  async create(): Promise<CareItemWithSchedules> {
    throw new Error("not used by these tests");
  }
  async listByUser(userId: string): Promise<CareItemWithSchedules[]> {
    return this.items.filter((i) => i.userId === userId);
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

class FakeCareLogRepository implements CareLogRepository {
  private logs: CareLog[] = [];
  private nextId = 1;

  seed(input: CreateCareLogInput): void {
    this.logs.push({
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
  async getBySlot(): Promise<CareLog | null> {
    throw new Error("not used by these tests");
  }
  async listByUserAndDate(): Promise<CareLog[]> {
    throw new Error("not used by these tests");
  }
  async listByUserAndDateRange(userId: string, from: string, to: string): Promise<CareLog[]> {
    return this.logs.filter((l) => l.userId === userId && l.localDate >= from && l.localDate <= to);
  }
}

function makeSchedule(overrides: Partial<CareSchedule> = {}): CareSchedule {
  return {
    id: "sched-1",
    careItemId: "item-1",
    timeOfDay: "08:00",
    repeatDays: [],
    weekInterval: 1,
    startDate: "2020-01-01",
    endDate: null,
    doseQuantity: 1,
    nagIntervalMinutes: 15,
    enabled: true,
    ...overrides,
  };
}

describe("getCareAdherence", () => {
  it("flattens the user's schedules (via listByUser) and combines them with range logs into a daily series", async () => {
    const careItemRepo = new FakeCareItemRepository();
    const careLogRepo = new FakeCareLogRepository();
    careItemRepo.add({ schedules: [makeSchedule()] });
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-21",
      timeOfDay: "08:00",
      status: "done",
      doneTime: new Date("2026-07-21T00:00:00Z"),
      doseQuantity: 1,
    });

    const result = await getCareAdherence({ careItemRepo, careLogRepo }, "user-1", "2026-07-20", "2026-07-22");

    expect(result).toEqual({
      from: "2026-07-20",
      to: "2026-07-22",
      days: [
        { date: "2026-07-20", scheduled: 1, done: 0, skipped: 0, missed: 0 },
        { date: "2026-07-21", scheduled: 1, done: 1, skipped: 0, missed: 0 },
        { date: "2026-07-22", scheduled: 1, done: 0, skipped: 0, missed: 0 },
      ],
    });
  });

  it("flattens schedules across multiple items", async () => {
    const careItemRepo = new FakeCareItemRepository();
    const careLogRepo = new FakeCareLogRepository();
    careItemRepo.add({ id: "item-1", schedules: [makeSchedule({ id: "sched-1", careItemId: "item-1" })] });
    careItemRepo.add({ id: "item-2", schedules: [makeSchedule({ id: "sched-2", careItemId: "item-2" })] });

    const result = await getCareAdherence({ careItemRepo, careLogRepo }, "user-1", "2026-07-20", "2026-07-20");

    expect(result.days[0].scheduled).toBe(2);
  });

  it("is scoped to the requested user: another user's schedules/logs are excluded", async () => {
    const careItemRepo = new FakeCareItemRepository();
    const careLogRepo = new FakeCareLogRepository();
    careItemRepo.add({ userId: "user-2", schedules: [makeSchedule()] });
    careLogRepo.seed({
      userId: "user-2",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-20",
      timeOfDay: "08:00",
      status: "done",
      doneTime: new Date("2026-07-20T00:00:00Z"),
      doseQuantity: 1,
    });

    const result = await getCareAdherence({ careItemRepo, careLogRepo }, "user-1", "2026-07-20", "2026-07-20");

    expect(result.days[0]).toEqual({ date: "2026-07-20", scheduled: 0, done: 0, skipped: 0, missed: 0 });
  });
});
