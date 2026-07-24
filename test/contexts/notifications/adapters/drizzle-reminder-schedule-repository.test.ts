import { describe, expect, it } from "vitest";
import { DrizzleReminderScheduleRepository } from "../../../../src/contexts/notifications/adapters/drizzle-reminder-schedule-repository";
import type { Db } from "../../../../src/shared/db/client";

/**
 * `listActiveAll` is a join (schedule x owner's timezone — D6b in
 * add-medication-reminders/design.md); this locks down the row-shape mapping
 * without a real DB, mirroring the DrizzleVitalsRepository read-coerce test's
 * fake-db-chain approach.
 */
function fakeDbReturningJoinedRows(rows: unknown[]): Db {
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

describe("DrizzleReminderScheduleRepository.listActiveAll", () => {
  it("maps each joined row to { schedule, timezone }", async () => {
    const joinedRow = {
      schedule: {
        id: "sched-1",
        userId: "user-1",
        category: "medication",
        label: "藥物",
        times: ["08:00"],
        daysOfWeek: [1, 3, 5],
        weekInterval: 1,
        anchorDate: "2026-07-01",
        enabled: true,
      },
      timezone: "Asia/Taipei",
    };
    const repo = new DrizzleReminderScheduleRepository(() => fakeDbReturningJoinedRows([joinedRow]));

    const result = await repo.listActiveAll();

    expect(result).toEqual([
      {
        schedule: {
          id: "sched-1",
          userId: "user-1",
          category: "medication",
          label: "藥物",
          times: ["08:00"],
          daysOfWeek: [1, 3, 5],
          weekInterval: 1,
          anchorDate: "2026-07-01",
          enabled: true,
        },
        timezone: "Asia/Taipei",
      },
    ]);
  });

  it("returns an empty array when nothing is active", async () => {
    const repo = new DrizzleReminderScheduleRepository(() => fakeDbReturningJoinedRows([]));

    expect(await repo.listActiveAll()).toEqual([]);
  });
});
