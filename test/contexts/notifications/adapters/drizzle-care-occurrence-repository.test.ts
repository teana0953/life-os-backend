import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DrizzleCareOccurrenceRepository } from "../../../../src/contexts/notifications/adapters/drizzle-care-occurrence-repository";
import type { Db } from "../../../../src/shared/db/client";
import { careOccurrence } from "../../../../src/shared/db/schema";

/**
 * `upsertBySlot` inserts only if absent (`onConflictDoNothing` on the unique
 * slot key — D5 in design.md) and, on a conflict, falls back to selecting the
 * already-materialized row (the same "insert, then select on empty
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
  id: "occ-1",
  userId: "user-1",
  careItemId: "item-1",
  careScheduleId: "sched-1",
  localDate: "2026-07-24",
  timeOfDay: "09:00",
  lastNotifiedAt: null,
  lastAttemptAt: null,
  lastSendOutcome: null,
  lastSendDetail: null,
};

describe("DrizzleCareOccurrenceRepository.upsertBySlot", () => {
  it("returns the newly inserted row when the insert succeeds", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDb({ insertReturning: [CREATED_ROW], selectRow: undefined }));

    const result = await repo.upsertBySlot({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
    });

    expect(result).toEqual(CREATED_ROW);
  });

  it("falls back to the existing row when the slot key already exists (empty returning on conflict)", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDb({ insertReturning: [], selectRow: CREATED_ROW }));

    const result = await repo.upsertBySlot({
      userId: "user-1",
      careItemId: "item-1",
      careScheduleId: "sched-1",
      localDate: "2026-07-24",
      timeOfDay: "09:00",
    });

    expect(result.id).toBe("occ-1");
  });
});

/**
 * `recordAttempt` always writes `last_attempt_at` / `last_send_outcome` /
 * `last_send_detail`, and additionally writes `last_notified_at` only when
 * `delivered` is true (D10 in design.md). The table and the `where` predicate
 * are captured too: losing the row filter would UPDATE every occurrence in the
 * table, which is by far this method's most destructive way to break.
 */
interface RecordAttemptCall {
  table?: unknown;
  values?: Record<string, unknown>;
  where?: unknown;
}

function fakeDbForRecordAttempt(saw: RecordAttemptCall): Db {
  return {
    update: (table: unknown) => {
      saw.table = table;
      return {
        set: (values: Record<string, unknown>) => {
          saw.values = values;
          return {
            where: (predicate: unknown) => {
              saw.where = predicate;
              return Promise.resolve();
            },
          };
        },
      };
    },
  } as unknown as Db;
}

describe("DrizzleCareOccurrenceRepository.recordAttempt", () => {
  it("writes last_attempt_at/outcome/detail and last_notified_at when delivered", async () => {
    const saw: RecordAttemptCall = {};
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDbForRecordAttempt(saw));
    const at = new Date("2026-07-24T01:00:00Z");

    await repo.recordAttempt("occ-1", { at, outcome: "sent", detail: null, delivered: true });

    expect(saw.values).toEqual({
      lastAttemptAt: at,
      lastSendOutcome: "sent",
      lastSendDetail: null,
      lastNotifiedAt: at,
    });
  });

  it("does not write last_notified_at when not delivered", async () => {
    const saw: RecordAttemptCall = {};
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDbForRecordAttempt(saw));
    const at = new Date("2026-07-24T01:00:00Z");

    await repo.recordAttempt("occ-1", { at, outcome: "failed", detail: "status_500", delivered: false });

    expect(saw.values).toEqual({
      lastAttemptAt: at,
      lastSendOutcome: "failed",
      lastSendDetail: "status_500",
    });
  });

  it("updates care_occurrence filtered to the given id, never the whole table", async () => {
    const saw: RecordAttemptCall = {};
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDbForRecordAttempt(saw));

    await repo.recordAttempt("occ-1", { at: new Date("2026-07-24T01:00:00Z"), outcome: "sent", detail: null, delivered: true });

    expect(saw.table).toBe(careOccurrence);
    expect(saw.where).toEqual(eq(careOccurrence.id, "occ-1"));
  });
});

describe("DrizzleCareOccurrenceRepository.getBySlot", () => {
  it("returns null when no row matches", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDb({ insertReturning: [], selectRow: undefined }));

    expect(await repo.getBySlot("sched-1", "2026-07-24", "09:00")).toBeNull();
  });

  it("maps the row when one matches", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDb({ insertReturning: [], selectRow: CREATED_ROW }));

    expect(await repo.getBySlot("sched-1", "2026-07-24", "09:00")).toEqual(CREATED_ROW);
  });
});

/**
 * `listPastUnlogged` LEFT JOINs care_log and filters `IS NULL` so an
 * already-logged past slot is excluded at the query level (not merely
 * skipped after the fact) — bounding markMissed's per-tick work.
 */
function fakeDbForListPastUnlogged(rows: unknown[]): Db {
  return {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => rows,
        }),
      }),
    }),
  } as unknown as Db;
}

describe("DrizzleCareOccurrenceRepository.listPastUnlogged", () => {
  it("maps the joined { occurrence } rows back to CareOccurrence", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDbForListPastUnlogged([{ occurrence: CREATED_ROW }]));

    const result = await repo.listPastUnlogged("sched-1", "2026-07-24");

    expect(result).toEqual([CREATED_ROW]);
  });

  it("returns an empty array when nothing is past-unlogged", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => fakeDbForListPastUnlogged([]));

    expect(await repo.listPastUnlogged("sched-1", "2026-07-24")).toEqual([]);
  });
});
