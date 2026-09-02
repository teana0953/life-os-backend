import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * The hand-added backfill `UPDATE` in `drizzle/0036_eager_mathemanic.sql` cannot
 * be exercised by `test/db/harness.ts`: `createTestDb()` applies every migration
 * to an empty database in one go, so there is never a pre-existing `care_log`
 * row to fill and the `SET NOT NULL` can never trip. Deleting the whole `UPDATE`
 * line leaves that suite green.
 *
 * So this file drives the migrations itself — everything up to 0035, then the
 * old rows, then 0036 — which is the only arrangement where "an existing row
 * ends up carrying its item's real values, not the deploy-window DEFAULTs" is a
 * statement about anything.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
const USER_ID = "33333333-3333-3333-3333-333333333333";
const ITEM_WITH_DOSE = "44444444-4444-4444-4444-444444444444";
const ITEM_WITHOUT_DOSE = "55555555-5555-5555-5555-555555555555";

async function migrationTags(): Promise<string[]> {
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

async function applyMigration(db: PGlite, tag: string): Promise<void> {
  const sql = await readFile(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) await db.exec(trimmed);
  }
}

type BackfilledRow = {
  care_item_id: string;
  item_title: string;
  item_category: string;
  item_dose: string | null;
};

let db: PGlite;
let rows: BackfilledRow[];
let notNullColumns: { column_name: string; is_nullable: string }[];

beforeAll(async () => {
  db = new PGlite();
  const tags = await migrationTags();
  const upTo0036 = tags.indexOf("0036_eager_mathemanic");
  expect(upTo0036).toBeGreaterThan(0);

  for (const tag of tags.slice(0, upTo0036)) await applyMigration(db, tag);

  // Pre-change rows: written by the old code, so they have no snapshot columns
  // at all (those are what 0036 adds) and their ids are still NOT NULL.
  await db.exec(`
    INSERT INTO users (id, firebase_uid, email) VALUES ('${USER_ID}', 'fb-backfill', 'backfill@example.com');
    INSERT INTO care_item (id, user_id, category, title, dose) VALUES
      ('${ITEM_WITH_DOSE}', '${USER_ID}', 'medication', '標靶藥', '1 顆'),
      ('${ITEM_WITHOUT_DOSE}', '${USER_ID}', 'rehab', '手部復健', NULL);
    INSERT INTO care_schedule (id, user_id, care_item_id, time_of_day, start_date) VALUES
      ('66666666-6666-6666-6666-666666666666', '${USER_ID}', '${ITEM_WITH_DOSE}', '09:00', '2026-08-01'),
      ('77777777-7777-7777-7777-777777777777', '${USER_ID}', '${ITEM_WITHOUT_DOSE}', '18:00', '2026-08-01');
    INSERT INTO care_log (user_id, care_item_id, care_schedule_id, local_date, time_of_day, status, dose_quantity) VALUES
      ('${USER_ID}', '${ITEM_WITH_DOSE}', '66666666-6666-6666-6666-666666666666', '2026-08-10', '09:00', 'done', 2),
      ('${USER_ID}', '${ITEM_WITHOUT_DOSE}', '77777777-7777-7777-7777-777777777777', '2026-08-10', '18:00', 'skipped', 1);
  `);

  await applyMigration(db, "0036_eager_mathemanic");

  rows = (
    await db.query<BackfilledRow>(
      `SELECT care_item_id, item_title, item_category, item_dose FROM care_log ORDER BY time_of_day`,
    )
  ).rows;
  notNullColumns = (
    await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'care_log' AND column_name IN ('item_title', 'item_category', 'item_dose')
       ORDER BY column_name`,
    )
  ).rows;
});

afterAll(async () => {
  await db?.close();
});

describe("migration 0036 backfills the snapshot onto pre-existing care_log rows", () => {
  it("fills each row from the item it points at, including one whose dose is null", async () => {
    expect(rows).toEqual([
      { care_item_id: ITEM_WITH_DOSE, item_title: "標靶藥", item_category: "medication", item_dose: "1 顆" },
      { care_item_id: ITEM_WITHOUT_DOSE, item_title: "手部復健", item_category: "rehab", item_dose: null },
    ]);
  });

  it("does not leave the deploy-window DEFAULTs behind on a backfilled row", async () => {
    // The point of the whole file. '' / 'custom' is exactly what these rows
    // would hold if the `UPDATE` were dropped and the `SET DEFAULT` (or an
    // `ADD COLUMN ... DEFAULT`) had filled them instead — a silent history
    // wipe rather than a failed migration, and indistinguishable at read time
    // from a real record of a 'custom' item with an empty title.
    for (const row of rows) {
      expect(row.item_title).not.toBe("");
      expect(row.item_category).not.toBe("custom");
    }
  });

  it("ends with both snapshot NOT NULLs in place and item_dose still nullable", async () => {
    // `SET NOT NULL` on a backfilled column only succeeds because the UPDATE
    // above covered every row: that is the migration's own guard against a row
    // the join missed, and it is only a real guard when rows already exist.
    expect(notNullColumns).toEqual([
      { column_name: "item_category", is_nullable: "NO" },
      { column_name: "item_dose", is_nullable: "YES" },
      { column_name: "item_title", is_nullable: "NO" },
    ]);
  });
});
