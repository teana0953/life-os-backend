import { describe, expect, it } from "vitest";
import { DrizzleCareLogRepository } from "../../../../src/contexts/notifications/adapters/drizzle-care-log-repository";
import type { Db } from "../../../../src/shared/db/client";

/**
 * `upsertIfAbsent` inserts only if absent (`onConflictDoNothing` on the
 * unique slot key — D6/D7 in design.md) and, on a conflict, falls back to
 * selecting the already-logged row (the same "insert, then select on empty
 * returning" race-fallback shape as DrizzleReminderOccurrenceRepository).
 */
function fakeDb(options: { insertReturning: unknown[]; selectRow: unknown; captureValues?: (v: unknown) => void }): Db {
  return {
    insert: () => ({
      values: (v: unknown) => {
        options.captureValues?.(v);
        return {
          onConflictDoNothing: () => ({
            returning: () => options.insertReturning,
          }),
        };
      },
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

const SNAPSHOT = {
  itemTitle: "Metformin",
  itemCategory: "medication",
  itemDose: "500mg",
} as const;

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
  ...SNAPSHOT,
};

const CREATE_INPUT = {
  userId: "user-1",
  careItemId: "item-1",
  careScheduleId: "sched-1",
  localDate: "2026-07-24",
  timeOfDay: "09:00",
  status: "done" as const,
  doneTime: CREATED_ROW.doneTime,
  doseQuantity: 2,
  ...SNAPSHOT,
};

describe("DrizzleCareLogRepository.upsertIfAbsent", () => {
  it("returns the newly inserted row with created=true when the insert succeeds", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDb({ insertReturning: [CREATED_ROW], selectRow: undefined }));

    const result = await repo.upsertIfAbsent(CREATE_INPUT);

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
      ...SNAPSHOT,
    });
  });

  // The snapshot is the only thing that survives the item's deletion
  // (design D1), so an insert that omits it writes an unnameable record.
  it("writes the item snapshot columns on insert", async () => {
    let written: Record<string, unknown> | undefined;
    const repo = new DrizzleCareLogRepository(() =>
      fakeDb({
        insertReturning: [CREATED_ROW],
        selectRow: undefined,
        captureValues: (v) => {
          written = v as Record<string, unknown>;
        },
      }),
    );

    await repo.upsertIfAbsent({ ...CREATE_INPUT, itemTitle: "Warfarin", itemCategory: "medication", itemDose: "3mg" });

    expect(written).toMatchObject({ itemTitle: "Warfarin", itemCategory: "medication", itemDose: "3mg" });
  });

  it("falls back to the existing row with created=false when the slot is already logged (empty returning on conflict)", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDb({ insertReturning: [], selectRow: CREATED_ROW }));

    const result = await repo.upsertIfAbsent({ ...CREATE_INPUT, status: "skipped", doneTime: null });

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
        ...SNAPSHOT,
      },
    ]);
  });

  // After ON DELETE SET NULL (design D2) both ids arrive as null; the mapper
  // must pass that through rather than coerce it, because null is what the
  // read path reads as "the item is gone".
  it("maps an orphaned row's null ids and snapshot through", async () => {
    const orphan = { ...CREATED_ROW, careItemId: null, careScheduleId: null, itemTitle: "Deleted med", itemDose: null };
    const repo = new DrizzleCareLogRepository(() => fakeDbReturningRows([orphan]));

    const [log] = await repo.listByUserAndDate("user-1", "2026-07-24");

    expect(log?.careItemId).toBeNull();
    expect(log?.careScheduleId).toBeNull();
    expect(log?.itemTitle).toBe("Deleted med");
    expect(log?.itemCategory).toBe("medication");
    expect(log?.itemDose).toBeNull();
  });

  it("returns an empty array when there are no logs for that day", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDbReturningRows([]));

    expect(await repo.listByUserAndDate("user-1", "2026-07-24")).toEqual([]);
  });
});

describe("DrizzleCareLogRepository.listByUserAndDateRange", () => {
  it("maps each row to a CareLog", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDbReturningRows([CREATED_ROW]));

    const result = await repo.listByUserAndDateRange("user-1", "2026-07-01", "2026-07-31");

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
        ...SNAPSHOT,
      },
    ]);
  });

  it("returns an empty array when there are no logs in range", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeDbReturningRows([]));

    expect(await repo.listByUserAndDateRange("user-1", "2026-07-01", "2026-07-31")).toEqual([]);
  });
});

/**
 * `upsert` OVERWRITES the log for the slot key (unlike `upsertIfAbsent`):
 * it first reads the row that was in place (for `previousStatus`), then
 * `onConflictDoUpdate`s the new status/doneTime/doseQuantity in.
 */
function fakeUpsertDb(options: {
  existingRow?: unknown;
  upsertedRow: unknown;
  captureValues?: (v: unknown) => void;
  captureConflict?: (c: unknown) => void;
}): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (options.existingRow === undefined ? [] : [options.existingRow]),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        options.captureValues?.(v);
        return {
          onConflictDoUpdate: (c: unknown) => {
            options.captureConflict?.(c);
            return { returning: () => [options.upsertedRow] };
          },
        };
      },
    }),
  } as unknown as Db;
}

const UPSERTED_ROW = {
  id: "log-1",
  userId: "user-1",
  careItemId: "item-1",
  careScheduleId: "sched-1",
  localDate: "2026-07-20",
  timeOfDay: "09:00",
  status: "skipped",
  doneTime: null,
  doseQuantity: 2,
  ...SNAPSHOT,
};

const UPSERT_INPUT = {
  userId: "user-1",
  careItemId: "item-1",
  careScheduleId: "sched-1",
  localDate: "2026-07-20",
  timeOfDay: "09:00",
  status: "skipped" as const,
  doneTime: null,
  doseQuantity: 2,
  ...SNAPSHOT,
};

describe("DrizzleCareLogRepository.upsert", () => {
  it("returns previousStatus=null when no log existed for the slot yet", async () => {
    const repo = new DrizzleCareLogRepository(() => fakeUpsertDb({ existingRow: undefined, upsertedRow: UPSERTED_ROW }));

    const result = await repo.upsert(UPSERT_INPUT);

    expect(result.previousStatus).toBeNull();
    expect(result.log).toEqual({
      id: "log-1",
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-20",
      timeOfDay: "09:00",
      status: "skipped",
      doneTime: null,
      doseQuantity: 2,
      ...SNAPSHOT,
    });
  });

  it("returns the prior status and overwrites it when a log already existed for the slot", async () => {
    const existingRow = { ...UPSERTED_ROW, status: "done", doneTime: new Date("2026-07-20T01:00:00Z") };
    const repo = new DrizzleCareLogRepository(() => fakeUpsertDb({ existingRow, upsertedRow: UPSERTED_ROW }));

    const result = await repo.upsert({ ...UPSERT_INPUT, status: "skipped" });

    expect(result.previousStatus).toBe("done");
    expect(result.log.status).toBe("skipped");
  });

  it("writes the item snapshot columns on the insert branch", async () => {
    let written: Record<string, unknown> | undefined;
    const repo = new DrizzleCareLogRepository(() =>
      fakeUpsertDb({
        upsertedRow: UPSERTED_ROW,
        captureValues: (v) => {
          written = v as Record<string, unknown>;
        },
      }),
    );

    await repo.upsert({ ...UPSERT_INPUT, itemTitle: "Warfarin", itemCategory: "medication", itemDose: "3mg" });

    expect(written).toMatchObject({ itemTitle: "Warfarin", itemCategory: "medication", itemDose: "3mg" });
  });

  // The snapshot must record the item as it stood when the record was FIRST
  // written (design D1: never re-synced). Editing a past slot re-runs this
  // insert with today's item values, so putting the snapshot columns in the
  // conflict `set` clause would silently restamp an existing record's name
  // with the item's current one.
  it("never restamps an existing record's snapshot: the conflict update touches only status/doneTime/doseQuantity", async () => {
    let conflict: { set?: Record<string, unknown> } | undefined;
    const repo = new DrizzleCareLogRepository(() =>
      fakeUpsertDb({
        existingRow: { ...UPSERTED_ROW, status: "done", itemTitle: "Old name" },
        upsertedRow: UPSERTED_ROW,
        captureConflict: (c) => {
          conflict = c as { set?: Record<string, unknown> };
        },
      }),
    );

    await repo.upsert({ ...UPSERT_INPUT, itemTitle: "Renamed", itemCategory: "custom", itemDose: "9mg" });

    expect(Object.keys(conflict?.set ?? {}).sort()).toEqual(["doneTime", "doseQuantity", "status"]);
  });
});
