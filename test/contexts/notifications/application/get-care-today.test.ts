import { describe, expect, it } from "vitest";
import { getCareToday } from "../../../../src/contexts/notifications/application/get-care-today";
import { isActiveOn } from "../../../../src/contexts/notifications/domain/care-schedule";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareItem,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
} from "../../../../src/contexts/notifications/domain/care-item";
import type { CareLog, CareLogRepository, CareLogStatus, CreateCareLogInput } from "../../../../src/contexts/notifications/domain/care-log";
import type { User } from "../../../../src/contexts/user/domain/user";
import type { UserRepository } from "../../../../src/contexts/user/domain/user-repository";

class FakeUserRepository implements UserRepository {
  private byId = new Map<string, User>();

  add(user: User): void {
    this.byId.set(user.id, user);
  }

  async getOrCreate(): Promise<User> {
    throw new Error("not used by these tests");
  }
  async updateTimezone(): Promise<void> {
    throw new Error("not used by these tests");
  }
  async getById(userId: string): Promise<User | null> {
    return this.byId.get(userId) ?? null;
  }
}

/** Mirrors DrizzleCareItemRepository.listActiveSchedulesForUserOn: owned + enabled + active-today (shared isActiveOn), ordered by time then title. */
class FakeCareItemRepository implements CareItemRepository {
  private entries: { item: CareItem; schedule: CareSchedule }[] = [];

  add(item: CareItem, schedule: CareSchedule): void {
    this.entries.push({ item, schedule });
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
  async listActiveSchedules(): Promise<ActiveCareSchedule[]> {
    throw new Error("not used by these tests");
  }
  async decrementStock(): Promise<void> {
    throw new Error("not used by these tests");
  }
  async incrementStock(): Promise<void> {
    throw new Error("not used by these tests");
  }

  async listActiveSchedulesForUserOn(userId: string, localDate: string): Promise<ActiveScheduleForUser[]> {
    return this.entries
      .filter((e) => e.item.userId === userId && e.schedule.enabled && isActiveOn(e.schedule, localDate))
      .sort((a, b) => a.schedule.timeOfDay.localeCompare(b.schedule.timeOfDay) || a.item.title.localeCompare(b.item.title));
  }
}

class FakeCareLogRepository implements CareLogRepository {
  private logs: CareLog[] = [];
  private nextId = 1;

  /** Test helper: seed a log directly (simulating a prior HTTP answer or Cron markMissed). */
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
  async listByUserAndDate(userId: string, localDate: string): Promise<CareLog[]> {
    return this.logs.filter((l) => l.userId === userId && l.localDate === localDate);
  }
  async listByUserAndDateRange(): Promise<CareLog[]> {
    throw new Error("not used by these tests");
  }
  async upsert(): Promise<{ log: CareLog; previousStatus: CareLogStatus | null }> {
    throw new Error("not used by these tests");
  }
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    firebaseUid: "uid-1",
    email: "alice@example.com",
    displayName: "Alice",
    timezone: "Asia/Taipei",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeItem(overrides: Partial<CareItem> = {}): CareItem {
  return {
    id: "item-1",
    userId: "user-1",
    category: "medication",
    title: "藥物",
    note: null,
    dose: "5mg",
    stock: null,
    stockAlert: null,
    ...overrides,
  };
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

// 2026-07-22T10:30:00Z is 2026-07-22 18:30 in Asia/Taipei (a Wednesday, weekday 3).
const NOW = new Date("2026-07-22T10:30:00Z");

function buildDeps() {
  const userRepo = new FakeUserRepository();
  const careItemRepo = new FakeCareItemRepository();
  const careLogRepo = new FakeCareLogRepository();
  userRepo.add(makeUser());
  return { userRepo, careItemRepo, careLogRepo };
}

describe("getCareToday", () => {
  it("an active-today schedule appears", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careItemRepo.add(makeItem(), makeSchedule());

    const result = await getCareToday({ userRepo, careItemRepo, careLogRepo }, "user-1", NOW);

    expect(result.date).toBe("2026-07-22");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ careScheduleId: "sched-1", category: "medication", title: "藥物", dose: "5mg" });
  });

  it.each([
    ["wrong weekday", { repeatDays: [1] }], // active-today is a Wednesday (weekday 3); only Monday selected
    ["off week-interval", { startDate: "2026-07-15", weekInterval: 2 }], // weeksSince = 1, odd -> off
    ["out of date range", { endDate: "2026-07-01" }],
    ["disabled", { enabled: false }],
  ])("a schedule inactive today (%s) is absent", async (_name, overrides) => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careItemRepo.add(makeItem(), makeSchedule(overrides));

    const result = await getCareToday({ userRepo, careItemRepo, careLogRepo }, "user-1", NOW);

    expect(result.items).toEqual([]);
  });

  it.each<[CareLogStatus]>([["done"], ["skipped"], ["missed"]])(
    "a slot with a %s log reflects that status + done_time (missed is defensive pass-through only)",
    async (status) => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem(), makeSchedule());
      const doneTime = status === "done" ? new Date("2026-07-22T09:00:00Z") : null;
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-22",
        timeOfDay: "08:00",
        status,
        doneTime,
        doseQuantity: 1,
      });

      const result = await getCareToday({ userRepo, careItemRepo, careLogRepo }, "user-1", NOW);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe(status);
      expect(result.items[0].doneTime).toEqual(doneTime);
    },
  );

  it("a logless slot past its time is overdue; before its time is pending", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    // NOW is 18:30 local.
    careItemRepo.add(makeItem({ id: "item-past" }), makeSchedule({ id: "sched-past", careItemId: "item-past", timeOfDay: "08:00" }));
    careItemRepo.add(makeItem({ id: "item-future" }), makeSchedule({ id: "sched-future", careItemId: "item-future", timeOfDay: "20:00" }));

    const result = await getCareToday({ userRepo, careItemRepo, careLogRepo }, "user-1", NOW);

    expect(result.items).toHaveLength(2);
    const byId = Object.fromEntries(result.items.map((i) => [i.careScheduleId, i.status]));
    expect(byId["sched-past"]).toBe("overdue");
    expect(byId["sched-future"]).toBe("pending");
  });

  it("multiple items are ordered by time_of_day", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careItemRepo.add(makeItem({ id: "item-c" }), makeSchedule({ id: "sched-c", careItemId: "item-c", timeOfDay: "20:00" }));
    careItemRepo.add(makeItem({ id: "item-a" }), makeSchedule({ id: "sched-a", careItemId: "item-a", timeOfDay: "07:00" }));
    careItemRepo.add(makeItem({ id: "item-b" }), makeSchedule({ id: "sched-b", careItemId: "item-b", timeOfDay: "12:00" }));

    const result = await getCareToday({ userRepo, careItemRepo, careLogRepo }, "user-1", NOW);

    expect(result.items.map((i) => i.careScheduleId)).toEqual(["sched-a", "sched-b", "sched-c"]);
  });

  it("returns { date, items: [] } when the user has no active-today schedules", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();

    const result = await getCareToday({ userRepo, careItemRepo, careLogRepo }, "user-1", NOW);

    expect(result).toEqual({ date: "2026-07-22", items: [] });
  });

  it("the user's timezone drives both the local date and the overdue/pending boundary (two timezones, same instant)", async () => {
    // 2026-07-22T23:00:00Z is 2026-07-23 07:00 in Asia/Taipei, and 2026-07-22 16:00 in America/Los_Angeles.
    const instant = new Date("2026-07-22T23:00:00Z");
    const userRepo = new FakeUserRepository();
    const careItemRepo = new FakeCareItemRepository();
    const careLogRepo = new FakeCareLogRepository();
    userRepo.add(makeUser({ id: "user-taipei", timezone: "Asia/Taipei" }));
    userRepo.add(makeUser({ id: "user-la", timezone: "America/Los_Angeles" }));
    careItemRepo.add(makeItem({ userId: "user-taipei" }), makeSchedule({ careItemId: "item-1", timeOfDay: "08:00" }));
    careItemRepo.add(
      makeItem({ id: "item-2", userId: "user-la" }),
      makeSchedule({ id: "sched-2", careItemId: "item-2", timeOfDay: "08:00" }),
    );

    const taipeiResult = await getCareToday({ userRepo, careItemRepo, careLogRepo }, "user-taipei", instant);
    const laResult = await getCareToday({ userRepo, careItemRepo, careLogRepo }, "user-la", instant);

    expect(taipeiResult.date).toBe("2026-07-23");
    expect(taipeiResult.items[0].status).toBe("pending"); // 07:00 local, before the 08:00 slot
    expect(laResult.date).toBe("2026-07-22");
    expect(laResult.items[0].status).toBe("overdue"); // 16:00 local, past the 08:00 slot
  });
});
