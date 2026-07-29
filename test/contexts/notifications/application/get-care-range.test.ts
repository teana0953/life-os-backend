import { describe, expect, it } from "vitest";
import { getCareRange } from "../../../../src/contexts/notifications/application/get-care-range";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
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

/** Mirrors DrizzleCareItemRepository.listByUser: ALL of the caller's items (schedules embedded), not filtered by enabled/active — getCareRange must filter those itself. */
class FakeCareItemRepository implements CareItemRepository {
  private items: CareItemWithSchedules[] = [];

  add(item: CareItemWithSchedules): void {
    this.items.push(item);
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
  async incrementStock(): Promise<void> {
    throw new Error("not used by these tests");
  }
}

class FakeCareLogRepository implements CareLogRepository {
  private logs: CareLog[] = [];
  private nextId = 1;

  /** Test helper: seed a log directly (simulating a prior HTTP answer or edit). */
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
    isAdmin: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
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

function makeItem(overrides: Partial<CareItemWithSchedules> = {}): CareItemWithSchedules {
  return {
    id: "item-1",
    userId: "user-1",
    category: "medication",
    title: "藥物",
    note: null,
    dose: "5mg",
    stock: null,
    stockAlert: null,
    schedules: [makeSchedule()],
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

describe("getCareRange", () => {
  it("enumerates each day in [from, to] with a slot for an every-day schedule, status derived by past/today/future", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careItemRepo.add(makeItem());

    const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-23", NOW);

    expect(result).toMatchObject({ from: "2026-07-21", to: "2026-07-23" });
    expect(result.days.map((d) => d.date)).toEqual(["2026-07-21", "2026-07-22", "2026-07-23"]);
    expect(result.days[0].items).toHaveLength(1);
    expect(result.days[0].items[0].status).toBe("missed"); // strictly-past day, no log
    expect(result.days[1].items[0].status).toBe("overdue"); // today, 08:00 <= 18:30 now
    expect(result.days[2].items[0].status).toBe("pending"); // future day
  });

  it("a from==to single-day range returns exactly one day", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careItemRepo.add(makeItem());

    const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-22", "2026-07-22", NOW);

    expect(result.days).toHaveLength(1);
    expect(result.days[0].date).toBe("2026-07-22");
  });

  it("a disabled schedule produces no slot on any day in the range", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careItemRepo.add(makeItem({ schedules: [makeSchedule({ enabled: false })] }));

    const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-23", NOW);

    for (const day of result.days) {
      expect(day.items).toEqual([]);
    }
  });

  it("a schedule inactive on a particular weekday is absent that day only (isActiveOn per-day)", async () => {
    // repeatDays=[3] = Wednesday only; 07-21 Tue, 07-22 Wed, 07-23 Thu.
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careItemRepo.add(makeItem({ schedules: [makeSchedule({ repeatDays: [3] })] }));

    const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-23", NOW);

    expect(result.days[0].items).toEqual([]); // Tue
    expect(result.days[1].items).toHaveLength(1); // Wed
    expect(result.days[2].items).toEqual([]); // Thu
  });

  it("a log for a slot wins over the derived status, carrying its done_time", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careItemRepo.add(makeItem());
    const doneTime = new Date("2026-07-21T01:00:00Z");
    careLogRepo.seed({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-21",
      timeOfDay: "08:00",
      status: "done",
      doneTime,
      doseQuantity: 1,
    });

    const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-23", NOW);

    expect(result.days[0].items[0]).toMatchObject({ status: "done", doneTime });
    // the other (logless) days still derive status normally.
    expect(result.days[1].items[0].status).toBe("overdue");
    expect(result.days[2].items[0].status).toBe("pending");
  });

  it("the owner's timezone drives both the day enumeration boundary and each slot's status", async () => {
    // 2026-07-22T23:00:00Z is 2026-07-23 07:00 in Asia/Taipei, and 2026-07-22 16:00 in America/Los_Angeles.
    const instant = new Date("2026-07-22T23:00:00Z");
    const userRepo = new FakeUserRepository();
    const careItemRepo = new FakeCareItemRepository();
    const careLogRepo = new FakeCareLogRepository();
    userRepo.add(makeUser({ id: "user-taipei", timezone: "Asia/Taipei" }));
    userRepo.add(makeUser({ id: "user-la", timezone: "America/Los_Angeles" }));
    careItemRepo.add(makeItem({ userId: "user-taipei" }));
    careItemRepo.add(makeItem({ id: "item-2", userId: "user-la", schedules: [makeSchedule({ id: "sched-2", careItemId: "item-2" })] }));

    const taipeiResult = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-taipei", "2026-07-23", "2026-07-23", instant);
    const laResult = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-la", "2026-07-22", "2026-07-22", instant);

    expect(taipeiResult.days[0].items[0].status).toBe("pending"); // 07:00 local, before the 08:00 slot
    expect(laResult.days[0].items[0].status).toBe("overdue"); // 16:00 local, past the 08:00 slot
  });

  it("returns { from, to, days: [] with empty items } when the user has no care items", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();

    const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-22", NOW);

    expect(result.days).toEqual([
      { date: "2026-07-21", items: [] },
      { date: "2026-07-22", items: [] },
    ]);
  });
});
