import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../src/shared/db/schema";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * preserve-care-logs-on-item-delete, D2: the guarantee this file pins is a
 * database one — `care_log`'s foreign keys are `ON DELETE SET NULL`, not
 * `CASCADE`, so deleting a care item cannot take the adherence history with
 * it no matter what the application layer does. Against the pre-change schema
 * every case here fails: the log row is gone (cascade) and the snapshot
 * columns do not exist.
 */

const USER_ID = "22222222-2222-2222-2222-222222222222";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  await testDb.resetDb();
});

async function seedItemScheduleAndLog(): Promise<{ itemId: string; scheduleId: string; logId: string }> {
  await insertUser(testDb.db, USER_ID, "care-history@example.com");
  const [item] = await testDb.db
    .insert(schema.careItem)
    .values({ userId: USER_ID, category: "medication", title: "標靶藥", dose: "1 顆" })
    .returning();
  const [careSchedule] = await testDb.db
    .insert(schema.careSchedule)
    .values({ userId: USER_ID, careItemId: item.id, timeOfDay: "09:00", startDate: "2026-08-01" })
    .returning();
  const [log] = await testDb.db
    .insert(schema.careLog)
    .values({
      userId: USER_ID,
      careItemId: item.id,
      careScheduleId: careSchedule.id,
      localDate: "2026-08-10",
      timeOfDay: "09:00",
      status: "done",
      doneTime: new Date("2026-08-10T01:05:00Z"),
      doseQuantity: 2,
      itemTitle: "標靶藥",
      itemCategory: "medication",
      itemDose: "1 顆",
    })
    .returning();
  return { itemId: item.id, scheduleId: careSchedule.id, logId: log.id };
}

describe("care_log survives its care item's deletion (PGlite)", () => {
  it("keeps the row, nulls both ids, and leaves the outcome and snapshot intact", async () => {
    const { itemId, logId } = await seedItemScheduleAndLog();

    await testDb.db.delete(schema.careItem).where(eq(schema.careItem.id, itemId));

    const rows = await testDb.db.select().from(schema.careLog).where(eq(schema.careLog.id, logId));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.careItemId).toBeNull();
    // The schedule is cascade-deleted with its item, so its own SET NULL fires
    // too — a record must survive losing both of its parents, not just one.
    expect(row.careScheduleId).toBeNull();
    expect(row.itemTitle).toBe("標靶藥");
    expect(row.itemCategory).toBe("medication");
    expect(row.itemDose).toBe("1 顆");
    expect(row.localDate).toBe("2026-08-10");
    expect(row.timeOfDay).toBe("09:00");
    expect(row.status).toBe("done");
    expect(row.doneTime).toEqual(new Date("2026-08-10T01:05:00Z"));
    expect(row.doseQuantity).toBe(2);
  });

  it("keeps the row when only the schedule is removed (an item edit dropping one time-of-day)", async () => {
    const { itemId, scheduleId, logId } = await seedItemScheduleAndLog();

    await testDb.db.delete(schema.careSchedule).where(eq(schema.careSchedule.id, scheduleId));

    const rows = await testDb.db.select().from(schema.careLog).where(eq(schema.careLog.id, logId));
    expect(rows).toHaveLength(1);
    // Only the schedule went: the item id must NOT be collateral damage, which
    // a blanket "null both ids on any delete" implementation would get wrong.
    expect(rows[0].careScheduleId).toBeNull();
    expect(rows[0].careItemId).toBe(itemId);
    expect(rows[0].itemTitle).toBe("標靶藥");
  });

  it("accepts an insert from the OLD writer, which sends none of the three snapshot columns", async () => {
    // The deploy window: .github/workflows/deploy.yml runs db:migrate BEFORE
    // `wrangler deploy`, so for the minutes in between the previous Worker is
    // live and its care_log inserts carry no item_title/item_category/item_dose.
    // Without the DEFAULTs the migration sets on the two NOT NULL columns, every
    // care-log write in that window fails with `null value in column
    // "item_title" ... violates not-null constraint` — POST /api/care/log, the
    // edit, and markMissedForUserDay/retireOrphanedOccurrences inside running
    // CareReminderWorkflow instances. Raw SQL, not the drizzle schema: the point
    // is a column list this codebase no longer produces.
    await insertUser(testDb.db, USER_ID, "care-history@example.com");
    const [item] = await testDb.db
      .insert(schema.careItem)
      .values({ userId: USER_ID, category: "medication", title: "標靶藥", dose: "1 顆" })
      .returning();
    const [careSchedule] = await testDb.db
      .insert(schema.careSchedule)
      .values({ userId: USER_ID, careItemId: item.id, timeOfDay: "09:00", startDate: "2026-08-01" })
      .returning();

    await testDb.db.execute(
      sql`INSERT INTO care_log (user_id, care_item_id, care_schedule_id, local_date, time_of_day, status, done_time, dose_quantity)
          VALUES (${USER_ID}, ${item.id}, ${careSchedule.id}, '2026-08-11', '09:00', 'done', NULL, 1)`,
    );

    const rows = await testDb.db.select().from(schema.careLog).where(eq(schema.careLog.localDate, "2026-08-11"));
    expect(rows).toHaveLength(1);
    // 'custom' is a real CareCategory, so a window row still reads back as a
    // valid category rather than something the domain cannot parse.
    expect(rows[0].itemCategory).toBe("custom");
    expect(rows[0].itemTitle).toBe("");
    // Invisible to users: care_item_id is still set at this point, and the read
    // path prefers the live item over the snapshot (design D4).
    expect(rows[0].careItemId).toBe(item.id);
  });

  it("lets a replacement item's schedule record the same date/time an orphaned row already occupies", async () => {
    // One orphan (NULL schedule) plus one live-schedule row on the same
    // (local_date, time_of_day): the unique key is
    // (care_schedule_id, local_date, time_of_day), so widening it to anything
    // the two rows share — user, item, or dropping care_schedule_id from it —
    // makes re-adding a reminder and answering it fail. NOT a guard against
    // `NULLS NOT DISTINCT`: only one of these two rows carries a NULL, so it
    // falls on one side of that distinction. The case below is that guard.
    const { itemId } = await seedItemScheduleAndLog();
    await testDb.db.delete(schema.careItem).where(eq(schema.careItem.id, itemId));

    const [replacement] = await testDb.db
      .insert(schema.careItem)
      .values({ userId: USER_ID, category: "medication", title: "新藥" })
      .returning();
    const [replacementSchedule] = await testDb.db
      .insert(schema.careSchedule)
      .values({ userId: USER_ID, careItemId: replacement.id, timeOfDay: "09:00", startDate: "2026-08-01" })
      .returning();
    await testDb.db.insert(schema.careLog).values({
      userId: USER_ID,
      careItemId: replacement.id,
      careScheduleId: replacementSchedule.id,
      localDate: "2026-08-10",
      timeOfDay: "09:00",
      status: "done",
      doneTime: null,
      doseQuantity: 1,
      itemTitle: "新藥",
      itemCategory: "medication",
      itemDose: null,
    });

    const all = await testDb.db.select().from(schema.careLog);
    expect(all).toHaveLength(2);
  });

  it("lets TWO items sharing one date and time both be deleted, leaving two NULL-schedule logs side by side", async () => {
    // The failure mode: the unique key is
    // (care_schedule_id, local_date, time_of_day), and it works here only
    // because Postgres treats NULLs as DISTINCT by default. Add
    // `NULLS NOT DISTINCT` to it and the SET NULL fired by the SECOND delete
    // would produce a duplicate (NULL, '2026-08-10', '09:00') — the delete
    // aborts, so the user gets a reminder that cannot be deleted at all, while
    // its log still points at a schedule that is on its way out.
    //
    // Two items answered at the same time on the same day is the whole fixture:
    // the case above has exactly ONE NULL-bearing row, which lands on one side
    // of the NULLS-NOT-DISTINCT boundary and therefore cannot detect it.
    await insertUser(testDb.db, USER_ID, "care-history@example.com");
    const itemIds: string[] = [];
    for (const title of ["早餐藥", "復健"]) {
      const [item] = await testDb.db
        .insert(schema.careItem)
        .values({ userId: USER_ID, category: "medication", title })
        .returning();
      const [sched] = await testDb.db
        .insert(schema.careSchedule)
        .values({ userId: USER_ID, careItemId: item.id, timeOfDay: "09:00", startDate: "2026-08-01" })
        .returning();
      await testDb.db.insert(schema.careLog).values({
        userId: USER_ID,
        careItemId: item.id,
        careScheduleId: sched.id,
        localDate: "2026-08-10",
        timeOfDay: "09:00",
        status: "done",
        doneTime: null,
        doseQuantity: 1,
        itemTitle: title,
        itemCategory: "medication",
        itemDose: null,
      });
      itemIds.push(item.id);
    }

    for (const itemId of itemIds) {
      await testDb.db.delete(schema.careItem).where(eq(schema.careItem.id, itemId));
    }

    const orphans = await testDb.db.select().from(schema.careLog);
    expect(orphans).toHaveLength(2);
    expect(orphans.every((r) => r.careScheduleId === null && r.careItemId === null)).toBe(true);
    expect(orphans.map((r) => r.itemTitle).sort()).toEqual(["復健", "早餐藥"].sort());
    // Both rows really do share the slot key the constraint covers, so the
    // NULLs are the only thing keeping them apart.
    expect(orphans.every((r) => r.localDate === "2026-08-10" && r.timeOfDay === "09:00")).toBe(true);
  });
});
