import { describe, expect, it } from "vitest";
import { getCareRange } from "../../../../src/contexts/notifications/application/get-care-range";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
} from "../../../../src/contexts/notifications/domain/care-item";
import type {
  CareLog,
  CareLogItemSnapshot,
  CareLogRepository,
  CareLogStatus,
  CreateCareLogInput,
} from "../../../../src/contexts/notifications/domain/care-log";
import type { User } from "../../../../src/contexts/user/domain/user";
import type { UserRepository } from "../../../../src/contexts/user/domain/user-repository";

type SeedLogInput = Omit<CreateCareLogInput, "careItemId" | "careScheduleId" | keyof CareLogItemSnapshot> &
  Partial<CareLogItemSnapshot> & { careItemId: string | null; careScheduleId: string | null };

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
  /** Counts the reads getCareRange makes; task 4.5 pins it at one regardless of orphan count. */
  listByUserCalls = 0;

  add(item: CareItemWithSchedules): void {
    this.items.push(item);
  }

  async create(): Promise<CareItemWithSchedules> {
    throw new Error("not used by these tests");
  }
  async listByUser(userId: string): Promise<CareItemWithSchedules[]> {
    this.listByUserCalls += 1;
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
  /** Counts the reads getCareRange makes; task 4.5 pins it at one regardless of orphan count. */
  listByUserAndDateRangeCalls = 0;

  /**
   * Test helper: seed a log directly (simulating a prior HTTP answer or edit).
   * The ids are nullable here — unlike `CreateCareLogInput`'s — because that is
   * exactly the row `ON DELETE SET NULL` leaves behind, and the whole point of
   * these tests. The snapshot defaults keep the pre-existing fixtures short.
   */
  seed(input: SeedLogInput): void {
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
      itemTitle: input.itemTitle ?? "藥物",
      itemCategory: input.itemCategory ?? "medication",
      itemDose: input.itemDose ?? null,
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
    this.listByUserAndDateRangeCalls += 1;
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

  // preserve-care-logs-on-item-delete D3/D4: a log is no longer a decoration on a
  // live slot. Every log in the range must surface exactly once, whatever became
  // of the schedule that produced it.
  describe("logs with no live slot (D3)", () => {
    it("a deleted item's log is returned on its own date, named from the snapshot and flagged item_deleted", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      // No item at all: the delete cascaded the item and its schedule away and
      // SET NULL left the log behind.
      careLogRepo.seed({
        userId: "user-1",
        careItemId: null,
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "09:00",
        status: "done",
        doneTime: new Date("2026-07-21T01:00:00Z"),
        doseQuantity: 2,
        itemTitle: "停用的藥",
        itemCategory: "medication",
        itemDose: "10mg",
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-23", NOW);

      expect(result.days[0].items).toHaveLength(1);
      expect(result.days[0].items[0]).toEqual({
        careItemId: null,
        careScheduleId: null,
        category: "medication",
        title: "停用的藥",
        note: null,
        dose: "10mg",
        timeOfDay: "09:00",
        localDate: "2026-07-21",
        status: "done",
        doneTime: new Date("2026-07-21T01:00:00Z"),
        doseQuantity: 2,
        itemDeleted: true,
      });
      // and only on its own date.
      expect(result.days[1].items).toEqual([]);
      expect(result.days[2].items).toEqual([]);
    });

    it("a disabled schedule's log is still returned on that date", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem({ schedules: [makeSchedule({ enabled: false })] }));
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-21",
        timeOfDay: "08:00",
        status: "skipped",
        doneTime: null,
        doseQuantity: 1,
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-23", NOW);

      expect(result.days[0].items).toHaveLength(1);
      expect(result.days[0].items[0]).toMatchObject({ status: "skipped", timeOfDay: "08:00", careScheduleId: "sched-1", itemDeleted: false });
      expect(result.days[1].items).toEqual([]); // the schedule is still disabled everywhere else
    });

    it("a log on a date its schedule is inactive on is still returned on that date", async () => {
      // repeatDays=[3] = Wednesday only; the log sits on Tuesday 07-21.
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem({ schedules: [makeSchedule({ repeatDays: [3] })] }));
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-21",
        timeOfDay: "08:00",
        status: "done",
        doneTime: new Date("2026-07-21T00:10:00Z"),
        doseQuantity: 1,
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-23", NOW);

      expect(result.days[0].items).toHaveLength(1); // Tue: from the log alone
      expect(result.days[0].items[0].status).toBe("done");
      expect(result.days[1].items).toHaveLength(1); // Wed: the live slot
      expect(result.days[2].items).toEqual([]); // Thu: neither
    });

    it("an unconsumed log carries its own stored status, time, done time and dose quantity, not the schedule's", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      // The schedule is disabled, so its 08:00 / doseQuantity 1 cannot be the source.
      careItemRepo.add(makeItem({ schedules: [makeSchedule({ enabled: false })] }));
      const doneTime = new Date("2026-07-21T14:05:00Z");
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-21",
        timeOfDay: "22:00",
        status: "done",
        doneTime,
        doseQuantity: 3,
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW);

      expect(result.days[0].items[0]).toMatchObject({ timeOfDay: "22:00", status: "done", doneTime, doseQuantity: 3 });
    });

    it("a strictly-past unconsumed log is NOT re-derived as missed", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careLogRepo.seed({
        userId: "user-1",
        careItemId: null,
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "08:00",
        status: "skipped",
        doneTime: null,
        doseQuantity: 1,
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW);

      expect(result.days[0].items[0].status).toBe("skipped");
    });

    it("a record whose SCHEDULE alone is gone keeps its item id, is NOT flagged item_deleted, and is named from the live item", async () => {
      // The distinction every other case in this file misses: the two foreign
      // keys are separate SET NULLs, so `careScheduleId: null` does NOT imply
      // the item went with it. This is an item edit that dropped one
      // time-of-day — the item is still in today's list, and flagging it
      // deleted would have the frontend render a reminder the user still uses
      // as gone. Every other seed here is either (item-1, sched-1) or
      // (null, null), which is why itemDeleted could be wired to the schedule
      // id and stay green.
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem({ title: "現在的名字", dose: "20mg" }));
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "21:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
        itemTitle: "快照名字",
        itemDose: "5mg",
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW);

      const orphan = result.days[0].items.find((i) => i.timeOfDay === "21:00");
      expect(orphan).toMatchObject({
        careItemId: "item-1",
        careScheduleId: null,
        itemDeleted: false,
        title: "現在的名字",
        dose: "20mg",
      });
    });

    it("a re-added schedule at the same time shows BOTH the derived missed slot and the old done record (accepted D3 consequence)", async () => {
      // Removing the 08:00 schedule after answering it and adding 08:00 back
      // gives one item two rows for the same date and time: the new schedule
      // expands with no log of its own (derived `missed`) and the old record
      // surfaces unconsumed (`done`, null schedule id). Contradictory to read,
      // and deliberately not collapsed — see the D3 note in design.md. Pinned
      // so nobody "tidies" it into a live slot swallowing the record, which
      // would delete history that actually happened.
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem({ schedules: [makeSchedule({ id: "sched-new" })] }));
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "08:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW);

      // Compared as a SET, not a list. The comparator is `timeOfDay` then
      // `title` and these two rows tie on both (same 08:00, and D4 names both
      // from the one live item), so their relative order is decided by
      // Array.prototype.sort's stability over insertion order — a fact about
      // the runtime, not a guarantee this use case makes. What is being pinned
      // is that BOTH rows are present; asserting a position would pin the
      // sort's tie behaviour by accident.
      const pairs = result.days[0].items.map((i) => ({ status: i.status, careScheduleId: i.careScheduleId }));
      expect(pairs).toHaveLength(2);
      expect(pairs).toContainEqual({ status: "missed", careScheduleId: "sched-new" });
      expect(pairs).toContainEqual({ status: "done", careScheduleId: null });
    });
  });

  describe("naming an unconsumed log (D4)", () => {
    it("a live item whose schedule lapsed shows its CURRENT title while a deleted item's log keeps the OLD one", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      // Renamed since the log was written, and its schedule is now disabled, so
      // the log is unconsumed but the item is still there.
      careItemRepo.add(makeItem({ title: "新名字", dose: "20mg", schedules: [makeSchedule({ enabled: false })] }));
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-21",
        timeOfDay: "08:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
        itemTitle: "舊名字",
        itemCategory: "medication",
        itemDose: "5mg",
      });
      careLogRepo.seed({
        userId: "user-1",
        careItemId: null,
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "09:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
        itemTitle: "已刪除的復健",
        itemCategory: "rehab",
        itemDose: null,
      });

      const [live, deleted] = (
        await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW)
      ).days[0].items;

      expect(live).toMatchObject({ title: "新名字", dose: "20mg", category: "medication", itemDeleted: false, careItemId: "item-1" });
      expect(deleted).toMatchObject({ title: "已刪除的復健", dose: null, category: "rehab", itemDeleted: true, careItemId: null });
    });

    it("a live item's note reaches the slot, and a deleted item's is null (the snapshot has no note)", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem({ note: "飯後", schedules: [makeSchedule({ enabled: false })] }));
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-21",
        timeOfDay: "08:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
      });
      careLogRepo.seed({
        userId: "user-1",
        careItemId: null,
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "09:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
      });

      const [live, deleted] = (
        await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW)
      ).days[0].items;

      expect(live.note).toBe("飯後");
      expect(deleted.note).toBeNull();
    });
  });

  describe("exactly once, in order (D3 step 3)", () => {
    it("a log matched by a live slot is emitted once, not also as an unconsumed log", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem());
      careLogRepo.seed({
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-21",
        timeOfDay: "08:00",
        status: "done",
        doneTime: new Date("2026-07-21T01:00:00Z"),
        doseQuantity: 1,
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW);

      expect(result.days[0].items).toHaveLength(1);
      expect(result.days[0].items[0].status).toBe("done");
    });

    it("the same schedule's log on two dates is consumed on each of them, never duplicated onto one", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem());
      for (const localDate of ["2026-07-21", "2026-07-22"]) {
        careLogRepo.seed({
          userId: "user-1",
          careItemId: "item-1",
          careScheduleId: "sched-1",
          localDate,
          timeOfDay: "08:00",
          status: "done",
          doneTime: null,
          doseQuantity: 1,
        });
      }

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-22", NOW);

      expect(result.days[0].items).toHaveLength(1);
      expect(result.days[1].items).toHaveLength(1);
    });

    it("unconsumed slots interleave with live ones by time_of_day then title, not appended after them", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem({ id: "live", title: "b-live", schedules: [makeSchedule({ id: "sched-live", careItemId: "live", timeOfDay: "12:00" })] }));
      careLogRepo.seed({
        userId: "user-1",
        careItemId: null,
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "07:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
        itemTitle: "z-early-orphan",
      });
      careLogRepo.seed({
        userId: "user-1",
        careItemId: null,
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "12:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
        itemTitle: "a-same-time-orphan",
      });
      careLogRepo.seed({
        userId: "user-1",
        careItemId: null,
        careScheduleId: null,
        localDate: "2026-07-21",
        timeOfDay: "20:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
        itemTitle: "y-late-orphan",
      });

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW);

      // Appending the orphans after the live slot would give
      // ["b-live", "z-early-orphan", "a-same-time-orphan", "y-late-orphan"].
      expect(result.days[0].items.map((i) => i.title)).toEqual(["z-early-orphan", "a-same-time-orphan", "b-live", "y-late-orphan"]);
    });

    it("issues exactly two repository reads however many orphaned logs the range holds", async () => {
      const { userRepo, careItemRepo, careLogRepo } = buildDeps();
      careItemRepo.add(makeItem());
      for (let i = 0; i < 20; i += 1) {
        careLogRepo.seed({
          userId: "user-1",
          careItemId: null,
          careScheduleId: null,
          localDate: "2026-07-21",
          timeOfDay: `${String(i).padStart(2, "0")}:00`,
          status: "done",
          doneTime: null,
          doseQuantity: 1,
        });
      }

      const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-23", NOW);

      expect(result.days[0].items).toHaveLength(21); // 20 orphans + the live slot
      expect(careItemRepo.listByUserCalls).toBe(1);
      expect(careLogRepo.listByUserAndDateRangeCalls).toBe(1);
    });
  });

  it("another user's orphaned log never leaks into this user's range", async () => {
    const { userRepo, careItemRepo, careLogRepo } = buildDeps();
    careLogRepo.seed({
      userId: "user-other",
      careItemId: null,
      careScheduleId: null,
      localDate: "2026-07-21",
      timeOfDay: "08:00",
      status: "done",
      doneTime: null,
      doseQuantity: 1,
    });

    const result = await getCareRange({ userRepo, careItemRepo, careLogRepo }, "user-1", "2026-07-21", "2026-07-21", NOW);

    expect(result.days[0].items).toEqual([]);
  });
});
