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
