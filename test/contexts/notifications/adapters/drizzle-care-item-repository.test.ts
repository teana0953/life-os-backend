import { describe, expect, it } from "vitest";
import { DrizzleCareItemRepository } from "../../../../src/contexts/notifications/adapters/drizzle-care-item-repository";
import type { Db } from "../../../../src/shared/db/client";

/**
 * `listActiveSchedules` is a two-way join (schedule x item x owner's timezone
 * — mirrors DrizzleReminderScheduleRepository.listActiveAll's `listActiveAll`
 * test); this locks down the row-shape mapping without a real DB.
 */
function fakeDbReturningJoinedRows(rows: unknown[]): Db {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => rows,
          }),
        }),
      }),
    }),
  } as unknown as Db;
}

describe("DrizzleCareItemRepository.listActiveSchedules", () => {
  it("maps each joined row to { item, schedule, timezone }", async () => {
    const joinedRow = {
      item: {
        id: "item-1",
        userId: "user-1",
        category: "medication",
        title: "藥物",
        note: null,
        dose: "5mg",
        stock: 10,
        stockAlert: 2,
      },
      schedule: {
        id: "sched-1",
        careItemId: "item-1",
        timeOfDay: "08:00",
        repeatDays: [1, 3, 5],
        weekInterval: 1,
        startDate: "2026-07-01",
        endDate: null,
        doseQuantity: 1,
        nagIntervalMinutes: 15,
        enabled: true,
      },
      timezone: "Asia/Taipei",
    };
    const repo = new DrizzleCareItemRepository(() => fakeDbReturningJoinedRows([joinedRow]));

    const result = await repo.listActiveSchedules();

    expect(result).toEqual([
      {
        item: {
          id: "item-1",
          userId: "user-1",
          category: "medication",
          title: "藥物",
          note: null,
          dose: "5mg",
          stock: 10,
          stockAlert: 2,
        },
        schedule: {
          id: "sched-1",
          careItemId: "item-1",
          timeOfDay: "08:00",
          repeatDays: [1, 3, 5],
          weekInterval: 1,
          startDate: "2026-07-01",
          endDate: null,
          doseQuantity: 1,
          nagIntervalMinutes: 15,
          enabled: true,
        },
        timezone: "Asia/Taipei",
      },
    ]);
  });

  it("returns an empty array when nothing is active", async () => {
    const repo = new DrizzleCareItemRepository(() => fakeDbReturningJoinedRows([]));

    expect(await repo.listActiveSchedules()).toEqual([]);
  });
});

/** `listActiveSchedulesForUserOn` is a one-way join (schedule x item, scoped to the caller's `WHERE`). */
function fakeDbReturningItemScheduleRows(rows: unknown[]): Db {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => rows,
        }),
      }),
    }),
  } as unknown as Db;
}

function itemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "item-1", userId: "user-1", category: "medication", title: "藥物 A", note: null, dose: "5mg", stock: 10, stockAlert: 2, ...overrides };
}

function scheduleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sched-1",
    careItemId: "item-1",
    timeOfDay: "08:00",
    repeatDays: [] as number[],
    weekInterval: 1,
    startDate: "2020-01-01",
    endDate: null,
    doseQuantity: 1,
    nagIntervalMinutes: 15,
    enabled: true,
    ...overrides,
  };
}

describe("DrizzleCareItemRepository.listActiveSchedulesForUserOn", () => {
  it("maps each joined row to { item, schedule }, filtered to active-today via the shared isActiveOn", async () => {
    // 2026-07-22 is a Wednesday (weekday 3): the first schedule (every day) is active,
    // the second (Monday-only) is not.
    const activeRow = { item: itemRow(), schedule: scheduleRow() };
    const inactiveRow = { item: itemRow({ id: "item-2" }), schedule: scheduleRow({ id: "sched-2", repeatDays: [1] }) };
    const repo = new DrizzleCareItemRepository(() => fakeDbReturningItemScheduleRows([activeRow, inactiveRow]));

    const result = await repo.listActiveSchedulesForUserOn("user-1", "2026-07-22");

    expect(result).toEqual([{ item: itemRow(), schedule: scheduleRow() }]);
  });

  it("orders by time_of_day, then title", async () => {
    const later = { item: itemRow({ id: "item-2", title: "藥物 B" }), schedule: scheduleRow({ id: "sched-2", timeOfDay: "20:00" }) };
    const earlierB = { item: itemRow({ id: "item-3", title: "藥物 B" }), schedule: scheduleRow({ id: "sched-3", timeOfDay: "08:00" }) };
    const earlierA = { item: itemRow({ id: "item-1", title: "藥物 A" }), schedule: scheduleRow({ id: "sched-1", timeOfDay: "08:00" }) };
    const repo = new DrizzleCareItemRepository(() => fakeDbReturningItemScheduleRows([later, earlierB, earlierA]));

    const result = await repo.listActiveSchedulesForUserOn("user-1", "2026-07-22");

    expect(result.map((r) => r.schedule.id)).toEqual(["sched-1", "sched-3", "sched-2"]);
  });

  it("returns an empty array when nothing is active today", async () => {
    const repo = new DrizzleCareItemRepository(() => fakeDbReturningItemScheduleRows([]));

    expect(await repo.listActiveSchedulesForUserOn("user-1", "2026-07-22")).toEqual([]);
  });
});

describe("DrizzleCareItemRepository.incrementStock", () => {
  it("issues an update that sets stock, scoped by a where clause", async () => {
    let sawSet = false;
    let sawWhere = false;
    const db = {
      update: () => ({
        set: (values: { stock: unknown }) => {
          sawSet = values.stock !== undefined;
          return {
            where: (where: unknown) => {
              sawWhere = where !== undefined;
              return Promise.resolve();
            },
          };
        },
      }),
    } as unknown as Db;
    const repo = new DrizzleCareItemRepository(() => db);

    await repo.incrementStock("item-1", 3);

    expect(sawSet).toBe(true);
    expect(sawWhere).toBe(true);
  });
});
