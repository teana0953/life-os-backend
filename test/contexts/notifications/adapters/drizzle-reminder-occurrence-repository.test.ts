import { describe, expect, it } from "vitest";
import { DrizzleReminderOccurrenceRepository } from "../../../../src/contexts/notifications/adapters/drizzle-reminder-occurrence-repository";
import type { Db } from "../../../../src/shared/db/client";

/**
 * `upsertByDedupeKey` inserts only if absent (`onConflictDoNothing` on the
 * unique `dedupe_key` — D2 in add-medication-reminders/design.md) and, on a
 * conflict, falls back to selecting the already-materialized row — the same
 * "insert, then select on empty returning" race-fallback shape as
 * DrizzleUserRepository.getOrCreate. This locks that fallback down without a
 * real DB.
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
  kind: "medication",
  dueAt: new Date("2026-07-24T01:00:00Z"),
  title: "藥物",
  body: "",
  status: "pending",
  dedupeKey: "sched-1|2026-07-24|09:00",
};

describe("DrizzleReminderOccurrenceRepository.upsertByDedupeKey", () => {
  it("returns the newly inserted row when the insert succeeds", async () => {
    const repo = new DrizzleReminderOccurrenceRepository(() => fakeDb({ insertReturning: [CREATED_ROW], selectRow: undefined }));

    const result = await repo.upsertByDedupeKey({
      userId: "user-1",
      kind: "medication",
      dueAt: CREATED_ROW.dueAt,
      title: "藥物",
      body: "",
      dedupeKey: CREATED_ROW.dedupeKey,
    });

    expect(result).toEqual({
      id: "occ-1",
      userId: "user-1",
      kind: "medication",
      dueAt: CREATED_ROW.dueAt,
      title: "藥物",
      body: "",
      status: "pending",
      dedupeKey: CREATED_ROW.dedupeKey,
    });
  });

  it("falls back to the existing row when the dedupe key already exists (empty returning on conflict)", async () => {
    const repo = new DrizzleReminderOccurrenceRepository(() => fakeDb({ insertReturning: [], selectRow: CREATED_ROW }));

    const result = await repo.upsertByDedupeKey({
      userId: "user-1",
      kind: "medication",
      dueAt: CREATED_ROW.dueAt,
      title: "藥物",
      body: "",
      dedupeKey: CREATED_ROW.dedupeKey,
    });

    expect(result.id).toBe("occ-1");
  });
});
