import { describe, expect, it } from "vitest";
import { DrizzleCareLogRepository } from "../../../../src/contexts/notifications/adapters/drizzle-care-log-repository";
import type { Db } from "../../../../src/shared/db/client";

/**
 * `upsertIfAbsent` inserts only if absent (`onConflictDoNothing` on the
 * unique slot key — D6/D7 in design.md) and, on a conflict, falls back to
 * selecting the already-logged row (the same "insert, then select on empty
 * returning" race-fallback shape as DrizzleReminderOccurrenceRepository).
 */
function fakeDb(options: { insertReturning: unknown[]; selectRow: unknown }): Db {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => options.insertReturning,
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => [options.selectRow],
        }),
      }),
    }),
  } as unknown as Db;
}

const CREATED_ROW = {
  id: "log-1",
  userId: "user-1",
  careItemId: "item-1",
  careScheduleId: "sched-1",
  localDate: "2026-07-24",
  timeOfDay: "09:00",
  status: "done",
  doneTime: new Date("2026-07-24T01:00:00Z"),
  doseQuantity: 2,
};

describe("DrizzleCareLogRepository.upsertIfAbsent", () => {
  it("returns the newly inserted row with created=true when the insert succeeds", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDb({ insertReturning: [CREATED_ROW], selectRow: undefined }));

    const result = await repo.upsertIfAbsent({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      status: "done",
      doneTime: CREATED_ROW.doneTime,
      doseQuantity: 2,
    });

    expect(result.created).toBe(true);
    expect(result.log).toEqual({
      id: "log-1",
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      status: "done",
      doneTime: CREATED_ROW.doneTime,
      doseQuantity: 2,
    });
  });

  it("falls back to the existing row with created=false when the slot is already logged (empty returning on conflict)", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDb({ insertReturning: [], selectRow: CREATED_ROW }));

    const result = await repo.upsertIfAbsent({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
      status: "skipped",
      doneTime: null,
      doseQuantity: 2,
    });

    expect(result.created).toBe(false);
    expect(result.log.id).toBe("log-1");
    expect(result.log.status).toBe("done"); // the existing row, unchanged by the new (ignored) status
  });
});

function fakeDbReturningRows(rows: unknown[]): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => rows,
      }),
    }),
  } as unknown as Db;
}

describe("DrizzleCareLogRepository.listByUserAndDate", () => {
  it("maps each row to a CareLog", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDbReturningRows([CREATED_ROW]));

    const result = await repo.listByUserAndDate("user-1", "2026-07-24");

    expect(result).toEqual([
      {
        id: "log-1",
        userId: "user-1",
        careItemId: "item-1",
        careScheduleId: "sched-1",
        localDate: "2026-07-24",
        timeOfDay: "09:00",
        status: "done",
        doneTime: CREATED_ROW.doneTime,
        doseQuantity: 2,
      },
    ]);
  });

  it("returns an empty array when there are no logs for that day", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDbReturningRows([]));

    expect(await repo.listByUserAndDate("user-1", "2026-07-24")).toEqual([]);
  });
});
