import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleCareOccurrenceRepository } from "../../src/contexts/notifications/adapters/drizzle-care-occurrence-repository";
import * as schema from "../../src/shared/db/schema";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * `claimAttempt`'s leased-claim semantics (gate_decision #1 in
 * replace-cron-with-workflows/design.md): the condition is `last_attempt_at
 * IS NULL OR last_attempt_at < now - lease`, not a compare-and-swap against
 * one exact expected value. Case (c) below — a stale claim being retaken —
 * is the entire reason this repo has a lease instead of a plain CAS; without
 * it, a claim that succeeds but never completes (crash between claim and
 * send) would be unrecoverable for the rest of the day on any
 * `nagIntervalMinutes = 0` schedule (see risks R3 / gate_decision #1).
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  await testDb.resetDb();
});

async function seedOccurrence(): Promise<string> {
  const userId = "11111111-1111-1111-1111-111111111111";
  await insertUser(testDb.db, userId, "claim@example.com");
  const [item] = await testDb.db
    .insert(schema.careItem)
    .values({ userId, category: "medication", title: "藥物" })
    .returning();
  const [careSchedule] = await testDb.db
    .insert(schema.careSchedule)
    .values({ userId, careItemId: item.id, timeOfDay: "09:00", startDate: "2026-07-01" })
    .returning();
  const [occurrence] = await testDb.db
    .insert(schema.careOccurrence)
    .values({ userId, careItemId: item.id, careScheduleId: careSchedule.id, localDate: "2026-07-24", timeOfDay: "09:00" })
    .returning();
  return occurrence.id;
}

describe("DrizzleCareOccurrenceRepository.claimAttempt (PGlite)", () => {
  it("(a) of two concurrent claimants on a never-attempted row, exactly one wins", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => testDb.db);
    const id = await seedOccurrence();
    const at = new Date("2026-07-24T01:00:00Z");

    const [first, second] = await Promise.all([
      repo.claimAttempt(id, { at, leaseMinutes: 10 }),
      repo.claimAttempt(id, { at, leaseMinutes: 10 }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("(b) a second claimant loses while the first claim's lease has not expired", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => testDb.db);
    const id = await seedOccurrence();
    const firstAt = new Date("2026-07-24T01:00:00Z");

    expect(await repo.claimAttempt(id, { at: firstAt, leaseMinutes: 10 })).toBe(true);

    // 5 minutes later: still within the 10-minute lease.
    const secondAt = new Date(firstAt.getTime() + 5 * 60_000);
    expect(await repo.claimAttempt(id, { at: secondAt, leaseMinutes: 10 })).toBe(false);
  });

  it("(c) a second claimant WINS once the first claim's lease has expired — this is the entire point of the lease", async () => {
    const repo = new DrizzleCareOccurrenceRepository(() => testDb.db);
    const id = await seedOccurrence();
    const firstAt = new Date("2026-07-24T01:00:00Z");

    expect(await repo.claimAttempt(id, { at: firstAt, leaseMinutes: 10 })).toBe(true);

    // 12 minutes later: the 10-minute lease has expired — the first claimant
    // presumably crashed between claiming and recording an outcome.
    const secondAt = new Date(firstAt.getTime() + 12 * 60_000);
    expect(await repo.claimAttempt(id, { at: secondAt, leaseMinutes: 10 })).toBe(true);
  });
});
