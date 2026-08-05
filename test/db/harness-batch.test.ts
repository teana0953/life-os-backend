import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { expenseGroup, users } from "../../src/shared/db/schema";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * The harness's own `batch` shim, under test.
 *
 * Every atomicity test in this suite is only as good as this shim: if it
 * silently committed each statement on its own, "the change and its activity
 * row live or die together" would pass with no transaction at all — a guard
 * that cannot fail. So the shim's rollback is pinned here, directly, before
 * anything else relies on it.
 */
const A = "11111111-1111-1111-1111-111111111111";
const G = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("test harness batch shim", () => {
  let harness: TestDb;

  beforeAll(async () => {
    harness = await createTestDb();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    await insertUser(harness.db, A, "a@example.com", "Ann");
  });

  it("commits every statement when they all succeed", async () => {
    const db = harness.db;
    await db.batch([
      db.insert(expenseGroup).values({ id: G, name: "Trip", createdByUserId: A }),
      db.update(users).set({ displayName: "Renamed" }).where(eq(users.id, A)),
    ]);

    expect(await db.select().from(expenseGroup)).toHaveLength(1);
    const [user] = await db.select().from(users).where(eq(users.id, A));
    expect(user?.displayName).toBe("Renamed");
  });

  it("rolls the earlier statements back when a later one fails", async () => {
    const db = harness.db;
    await expect(
      db.batch([
        db.insert(expenseGroup).values({ id: G, name: "Trip", createdByUserId: A }),
        // `created_by_user_id` references `users`, and this id is not a user:
        // a foreign-key violation raised by the *second* statement.
        db.insert(expenseGroup).values({ name: "Doomed", createdByUserId: "99999999-9999-9999-9999-999999999999" }),
      ]),
    ).rejects.toThrow();

    // The first insert had already succeeded when the second one blew up. If
    // the shim were not wrapping them in a transaction, this row would be here.
    expect(await db.select().from(expenseGroup)).toHaveLength(0);
  });

  it("leaves the connection usable after a rollback", async () => {
    const db = harness.db;
    await expect(
      db.batch([db.insert(expenseGroup).values({ name: "Doomed", createdByUserId: "99999999-9999-9999-9999-999999999999" })]),
    ).rejects.toThrow();

    // A failed batch that never issued `ROLLBACK` would leave PGlite's single
    // connection in "current transaction is aborted", failing every later
    // case in the file for a reason that has nothing to do with what it tests.
    await db.insert(expenseGroup).values({ id: G, name: "Trip", createdByUserId: A });
    expect(await db.select().from(expenseGroup)).toHaveLength(1);
  });

  it("lets a later statement see an earlier one's effect", async () => {
    const db = harness.db;
    await db.batch([
      db.insert(expenseGroup).values({ id: G, name: "Trip", createdByUserId: A }),
      // Only matches if the insert above is already visible inside the
      // transaction — the property the conditional activity inserts depend on.
      db.update(expenseGroup).set({ name: "Renamed" }).where(eq(expenseGroup.id, G)),
    ]);

    const [group] = await db.select().from(expenseGroup);
    expect(group?.name).toBe("Renamed");
  });
});
