import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleCareOccurrenceRepository } from "../../src/contexts/notifications/adapters/drizzle-care-occurrence-repository";
import * as schema from "../../src/shared/db/schema";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * `listByUserAndDate` / `listPastUnloggedForUser` replace the per-schedule
 * `getBySlot` / `listPastUnlogged` loops on the reminder path
 * (fix-care-reminder-subrequest-n-plus-1 design.md D1). The counting tests in
 * the application layer prove the read count stopped growing; they cannot
 * prove the batched read returns the *same rows*, because their fakes have no
 * SQL. That is what this file is for — the spec scenario "Batched reads return
 * exactly what the per-slot reads returned".
 *
 * The fixture deliberately puts a decoy on the far side of every filter term:
 * another user, another day (both past and future), and an already-logged
 * slot. Without those, dropping the `user_id` filter or the `LEFT JOIN
 * care_log IS NULL` term returns a superset that a "contains the expected
 * rows" assertion still accepts.
 */

let testDb: TestDb;
let repo: DrizzleCareOccurrenceRepository;

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";
const TODAY = "2026-07-24";
const YESTERDAY = "2026-07-23";

beforeAll(async () => {
  testDb = await createTestDb();
  repo = new DrizzleCareOccurrenceRepository(() => testDb.db);
});

beforeEach(async () => {
  await testDb.resetDb();
  await insertUser(testDb.db, USER, "batch@example.com");
  await insertUser(testDb.db, OTHER_USER, "other@example.com");
});

async function insertSchedule(userId: string, timeOfDay: string): Promise<{ careItemId: string; careScheduleId: string }> {
  const [item] = await testDb.db.insert(schema.careItem).values({ userId, category: "medication", title: "藥物" }).returning();
  const [careSchedule] = await testDb.db
    .insert(schema.careSchedule)
    .values({ userId, careItemId: item.id, timeOfDay, startDate: "2026-07-01" })
    .returning();
  return { careItemId: item.id, careScheduleId: careSchedule.id };
}

async function insertOccurrence(input: {
  userId: string;
  careItemId: string;
  careScheduleId: string;
  localDate: string;
  timeOfDay: string;
}): Promise<string> {
  const [occurrence] = await testDb.db.insert(schema.careOccurrence).values(input).returning();
  return occurrence.id;
}

async function insertLog(input: { userId: string; careItemId: string; careScheduleId: string; localDate: string; timeOfDay: string }): Promise<void> {
  await testDb.db.insert(schema.careLog).values({ ...input, status: "done" });
}

describe("listByUserAndDate (PGlite)", () => {
  it("returns exactly the rows the per-slot getBySlot calls returned for that user and day", async () => {
    const morning = await insertSchedule(USER, "09:00");
    const evening = await insertSchedule(USER, "21:00");
    const morningId = await insertOccurrence({ ...morning, userId: USER, localDate: TODAY, timeOfDay: "09:00" });
    const eveningId = await insertOccurrence({ ...evening, userId: USER, localDate: TODAY, timeOfDay: "21:00" });

    const perSlot = [
      await repo.getBySlot(morning.careScheduleId, TODAY, "09:00"),
      await repo.getBySlot(evening.careScheduleId, TODAY, "21:00"),
    ];
    const batched = await repo.listByUserAndDate(USER, TODAY);

    expect(batched.map((o) => o.id).sort()).toEqual([morningId, eveningId].sort());
    expect([...batched].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      perSlot.map((o) => o!).sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("excludes another user's rows and another day's rows", async () => {
    const mine = await insertSchedule(USER, "09:00");
    const theirs = await insertSchedule(OTHER_USER, "09:00");
    const todayId = await insertOccurrence({ ...mine, userId: USER, localDate: TODAY, timeOfDay: "09:00" });
    await insertOccurrence({ ...mine, userId: USER, localDate: YESTERDAY, timeOfDay: "09:00" });
    await insertOccurrence({ ...theirs, userId: OTHER_USER, localDate: TODAY, timeOfDay: "09:00" });

    const batched = await repo.listByUserAndDate(USER, TODAY);

    expect(batched.map((o) => o.id)).toEqual([todayId]);
  });

  it("includes an already-logged slot: today's batch is the dispatch index, not a to-do list", async () => {
    const mine = await insertSchedule(USER, "09:00");
    const id = await insertOccurrence({ ...mine, userId: USER, localDate: TODAY, timeOfDay: "09:00" });
    await insertLog({ ...mine, userId: USER, localDate: TODAY, timeOfDay: "09:00" });

    expect((await repo.listByUserAndDate(USER, TODAY)).map((o) => o.id)).toEqual([id]);
  });

  it("carries the whole row, not just the slot key — the dispatch decision reads the attempt state off it", async () => {
    const mine = await insertSchedule(USER, "09:00");
    const id = await insertOccurrence({ ...mine, userId: USER, localDate: TODAY, timeOfDay: "09:00" });
    const at = new Date("2026-07-24T01:00:00Z");
    await repo.recordAttempt(id, { at, outcome: "failed", detail: "status_500", delivered: false });

    const [row] = await repo.listByUserAndDate(USER, TODAY);

    expect(row).toEqual({
      id,
      userId: USER,
      careItemId: mine.careItemId,
      careScheduleId: mine.careScheduleId,
      localDate: TODAY,
      timeOfDay: "09:00",
      lastNotifiedAt: null,
      lastAttemptAt: at,
      lastSendOutcome: "failed",
      lastSendDetail: "status_500",
    });
  });
});

describe("listPastUnloggedForUser (PGlite)", () => {
  it("returns exactly the union of the per-schedule listPastUnlogged results for that user", async () => {
    const morning = await insertSchedule(USER, "09:00");
    const evening = await insertSchedule(USER, "21:00");
    const a = await insertOccurrence({ ...morning, userId: USER, localDate: YESTERDAY, timeOfDay: "09:00" });
    const b = await insertOccurrence({ ...evening, userId: USER, localDate: YESTERDAY, timeOfDay: "21:00" });

    const perSchedule = [
      ...(await repo.listPastUnlogged(morning.careScheduleId, TODAY)),
      ...(await repo.listPastUnlogged(evening.careScheduleId, TODAY)),
    ];
    const batched = await repo.listPastUnloggedForUser(USER, TODAY);

    expect(batched.map((o) => o.id).sort()).toEqual([a, b].sort());
    expect(batched.map((o) => o.id).sort()).toEqual(perSchedule.map((o) => o.id).sort());
  });

  it("excludes another user's past-unlogged rows", async () => {
    const mine = await insertSchedule(USER, "09:00");
    const theirs = await insertSchedule(OTHER_USER, "09:00");
    const mineId = await insertOccurrence({ ...mine, userId: USER, localDate: YESTERDAY, timeOfDay: "09:00" });
    await insertOccurrence({ ...theirs, userId: OTHER_USER, localDate: YESTERDAY, timeOfDay: "09:00" });

    expect((await repo.listPastUnloggedForUser(USER, TODAY)).map((o) => o.id)).toEqual([mineId]);
  });

  it("excludes today's and a future day's rows: strictly before todayLocalDate", async () => {
    const mine = await insertSchedule(USER, "09:00");
    const pastId = await insertOccurrence({ ...mine, userId: USER, localDate: YESTERDAY, timeOfDay: "09:00" });
    await insertOccurrence({ ...mine, userId: USER, localDate: TODAY, timeOfDay: "09:00" });
    await insertOccurrence({ ...mine, userId: USER, localDate: "2026-07-25", timeOfDay: "09:00" });

    expect((await repo.listPastUnloggedForUser(USER, TODAY)).map((o) => o.id)).toEqual([pastId]);
  });

  it("excludes an already-logged past slot, and only that slot", async () => {
    const morning = await insertSchedule(USER, "09:00");
    const evening = await insertSchedule(USER, "21:00");
    await insertOccurrence({ ...morning, userId: USER, localDate: YESTERDAY, timeOfDay: "09:00" });
    const unloggedId = await insertOccurrence({ ...evening, userId: USER, localDate: YESTERDAY, timeOfDay: "21:00" });
    await insertLog({ ...morning, userId: USER, localDate: YESTERDAY, timeOfDay: "09:00" });

    expect((await repo.listPastUnloggedForUser(USER, TODAY)).map((o) => o.id)).toEqual([unloggedId]);
  });

  it("matches on the whole slot key: a log for the same schedule on a different day does not hide the occurrence", async () => {
    const mine = await insertSchedule(USER, "09:00");
    const id = await insertOccurrence({ ...mine, userId: USER, localDate: YESTERDAY, timeOfDay: "09:00" });
    await insertLog({ ...mine, userId: USER, localDate: "2026-07-22", timeOfDay: "09:00" });

    expect((await repo.listPastUnloggedForUser(USER, TODAY)).map((o) => o.id)).toEqual([id]);
  });
});
