import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleCareDayInstancePointerStore } from "../../src/contexts/notifications/adapters/drizzle-care-day-instance-pointer-store";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * `setCurrentIfMatch`'s compare-and-swap (fix/restart-instance-tracking) is a
 * single `INSERT ... ON CONFLICT ... setWhere` statement — the property that
 * matters is that Postgres itself serializes two concurrent callers racing
 * the same `expected` value so only one wins, which an in-memory fake can
 * only ever simulate, never prove. That is what `Promise.all` below actually
 * tests: both `setCurrentIfMatch` calls are issued to PGlite at once.
 */

let testDb: TestDb;
const USER_ID = "22222222-2222-2222-2222-222222222222";
const LOCAL_DATE = "2026-08-12";

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  await testDb.resetDb();
  await insertUser(testDb.db, USER_ID, "pointer@example.com");
});

describe("DrizzleCareDayInstancePointerStore (PGlite)", () => {
  it("getCurrent returns null when no row exists", async () => {
    const store = new DrizzleCareDayInstancePointerStore(() => testDb.db);

    expect(await store.getCurrent(USER_ID, LOCAL_DATE)).toBeNull();
  });

  it("setCurrentIfMatch(expected: null) succeeds when no row exists, and getCurrent then returns it", async () => {
    const store = new DrizzleCareDayInstancePointerStore(() => testDb.db);

    expect(await store.setCurrentIfMatch(USER_ID, LOCAL_DATE, null, "instance-a")).toBe(true);
    expect(await store.getCurrent(USER_ID, LOCAL_DATE)).toBe("instance-a");
  });

  it("setCurrentIfMatch succeeds when `expected` matches the current recorded instance, and advances it", async () => {
    const store = new DrizzleCareDayInstancePointerStore(() => testDb.db);
    await store.setCurrentIfMatch(USER_ID, LOCAL_DATE, null, "instance-a");

    expect(await store.setCurrentIfMatch(USER_ID, LOCAL_DATE, "instance-a", "instance-b")).toBe(true);
    expect(await store.getCurrent(USER_ID, LOCAL_DATE)).toBe("instance-b");
  });

  it("setCurrentIfMatch fails (and leaves the row untouched) when `expected` does not match", async () => {
    const store = new DrizzleCareDayInstancePointerStore(() => testDb.db);
    await store.setCurrentIfMatch(USER_ID, LOCAL_DATE, null, "instance-a");

    expect(await store.setCurrentIfMatch(USER_ID, LOCAL_DATE, "wrong-expected", "instance-b")).toBe(false);
    expect(await store.getCurrent(USER_ID, LOCAL_DATE)).toBe("instance-a");
  });

  it("getCurrent returns null when the stored row is for a different (stale) local date", async () => {
    const store = new DrizzleCareDayInstancePointerStore(() => testDb.db);
    await store.setCurrentIfMatch(USER_ID, "2026-08-11", null, "instance-yesterday");

    expect(await store.getCurrent(USER_ID, LOCAL_DATE)).toBeNull();
  });

  it("setCurrentIfMatch(expected: null) succeeds when the stored row is for a stale local date, overwriting it with today's", async () => {
    const store = new DrizzleCareDayInstancePointerStore(() => testDb.db);
    await store.setCurrentIfMatch(USER_ID, "2026-08-11", null, "instance-yesterday");

    expect(await store.setCurrentIfMatch(USER_ID, LOCAL_DATE, null, "instance-today")).toBe(true);
    expect(await store.getCurrent(USER_ID, LOCAL_DATE)).toBe("instance-today");
    // Yesterday's row is gone (overwritten, single row per user) — not merely shadowed.
    expect(await store.getCurrent(USER_ID, "2026-08-11")).toBeNull();
  });

  it("of two concurrent setCurrentIfMatch(expected: null) calls (racing to become today's pointer), exactly one wins", async () => {
    const store = new DrizzleCareDayInstancePointerStore(() => testDb.db);

    const [first, second] = await Promise.all([
      store.setCurrentIfMatch(USER_ID, LOCAL_DATE, null, "instance-a"),
      store.setCurrentIfMatch(USER_ID, LOCAL_DATE, null, "instance-b"),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    const current = await store.getCurrent(USER_ID, LOCAL_DATE);
    expect(["instance-a", "instance-b"]).toContain(current);
  });
});
