import { and, eq, isNotNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzlePushDeliveryRepository } from "../../src/contexts/notifications/adapters/drizzle-push-delivery-repository";
import { DrizzlePushSubscriptionRepository } from "../../src/contexts/notifications/adapters/drizzle-push-subscription-repository";
import { hashAckToken } from "../../src/contexts/notifications/domain/ack-token";
import * as schema from "../../src/shared/db/schema";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * `markAcked` is the authorization decision for the one route in this API that
 * Firebase does not guard, and all of it lives in a single `UPDATE ... WHERE`.
 * That makes these the only tests that can prove it: an in-memory fake accepts
 * whatever predicate it is handed, which is precisely the failure mode this
 * repo has already shipped once ("the reminders never sent a single push, and
 * 1400 tests were green").
 *
 * Each case below removes exactly one of the three conditions if it is
 * deleted from the SQL.
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  await testDb.resetDb();
  await insertUser(testDb.db, USER_ID, "ack@example.com");
});

const USER_ID = "22222222-2222-2222-2222-222222222222";
const SENT_AT = new Date("2026-08-18T09:00:00Z");
/** SENT_AT + 300s: the TTL a nag=5 schedule sends with. */
const EXPIRES_AT = new Date("2026-08-18T09:05:00Z");
const WITHIN_TTL = new Date("2026-08-18T09:02:00Z");
const AFTER_TTL = new Date("2026-08-18T09:06:00Z");

async function seedOccurrence(localDate: string): Promise<string> {
  const [item] = await testDb.db.insert(schema.careItem).values({ userId: USER_ID, category: "medication", title: "藥物" }).returning();
  const [careSchedule] = await testDb.db
    .insert(schema.careSchedule)
    .values({ userId: USER_ID, careItemId: item.id, timeOfDay: "09:00", startDate: "2026-07-01" })
    .returning();
  const [occurrence] = await testDb.db
    .insert(schema.careOccurrence)
    .values({ userId: USER_ID, careItemId: item.id, careScheduleId: careSchedule.id, localDate, timeOfDay: "09:00" })
    .returning();
  return occurrence.id;
}

async function seedSubscription(endpoint: string): Promise<string> {
  const [row] = await testDb.db
    .insert(schema.pushSubscription)
    .values({ userId: USER_ID, endpoint, p256dh: "p256dh", auth: "auth" })
    .returning();
  return row.id;
}

/** Registers one delivery through the repository under test and returns the plaintext token that was minted for it. */
async function seedDelivery(token: string, occurrenceId: string, subscriptionId: string, expiresAt = EXPIRES_AT): Promise<void> {
  const repository = new DrizzlePushDeliveryRepository(() => testDb.db);
  await repository.registerSent([
    {
      careOccurrenceId: occurrenceId,
      pushSubscriptionId: subscriptionId,
      tokenHash: await hashAckToken(token),
      sentAt: SENT_AT,
      expiresAt,
    },
  ]);
}

async function ackedAtFor(token: string): Promise<Date | null> {
  const [row] = await testDb.db.select().from(schema.pushDelivery).where(eq(schema.pushDelivery.tokenHash, await hashAckToken(token)));
  return row?.ackedAt ?? null;
}

describe("DrizzlePushDeliveryRepository.markAcked (PGlite)", () => {
  it("marks the matching row, and only from that moment is the occurrence provably delivered", async () => {
    const occurrenceId = await seedOccurrence("2026-08-18");
    const subscriptionId = await seedSubscription("https://push.example.com/a");
    await seedDelivery("token-a", occurrenceId, subscriptionId);
    const repository = new DrizzlePushDeliveryRepository(() => testDb.db);

    const deliveredBefore = await testDb.db
      .select()
      .from(schema.pushDelivery)
      .where(and(eq(schema.pushDelivery.careOccurrenceId, occurrenceId), isNotNull(schema.pushDelivery.ackedAt)));
    expect(deliveredBefore).toHaveLength(0);

    expect(await repository.markAcked(await hashAckToken("token-a"), WITHIN_TTL)).toBe(true);

    expect(await ackedAtFor("token-a")).toEqual(WITHIN_TTL);
    const deliveredAfter = await testDb.db
      .select()
      .from(schema.pushDelivery)
      .where(and(eq(schema.pushDelivery.careOccurrenceId, occurrenceId), isNotNull(schema.pushDelivery.ackedAt)));
    expect(deliveredAfter).toHaveLength(1);
  });

  it("LINCHPIN: an unknown token marks nothing", async () => {
    const occurrenceId = await seedOccurrence("2026-08-18");
    const subscriptionId = await seedSubscription("https://push.example.com/a");
    await seedDelivery("token-a", occurrenceId, subscriptionId);
    const repository = new DrizzlePushDeliveryRepository(() => testDb.db);

    expect(await repository.markAcked(await hashAckToken("never-issued"), WITHIN_TTL)).toBe(false);

    expect(await ackedAtFor("token-a")).toBeNull();
  });

  it("LINCHPIN: another delivery's token marks only its own row", async () => {
    // Two rows, two occurrences, two devices: dropping the `token_hash`
    // condition would update both and still report success, so a single-row
    // fixture cannot catch it.
    const occurrenceA = await seedOccurrence("2026-08-18");
    const occurrenceB = await seedOccurrence("2026-08-19");
    const subscriptionA = await seedSubscription("https://push.example.com/a");
    const subscriptionB = await seedSubscription("https://push.example.com/b");
    await seedDelivery("token-a", occurrenceA, subscriptionA);
    await seedDelivery("token-b", occurrenceB, subscriptionB);
    const repository = new DrizzlePushDeliveryRepository(() => testDb.db);

    await repository.markAcked(await hashAckToken("token-a"), WITHIN_TTL);

    expect(await ackedAtFor("token-a")).toEqual(WITHIN_TTL);
    expect(await ackedAtFor("token-b")).toBeNull();
  });

  it("LINCHPIN: a token whose TTL has elapsed marks nothing", async () => {
    // Past the TTL the push service was no longer permitted to deliver
    // (RFC8030 5.2), so an ack for it cannot be truthful. This is the one
    // condition no application-level fake can test: a hand-written repository
    // simply accepts the token it is given.
    const occurrenceId = await seedOccurrence("2026-08-18");
    const subscriptionId = await seedSubscription("https://push.example.com/a");
    await seedDelivery("token-a", occurrenceId, subscriptionId);
    const repository = new DrizzlePushDeliveryRepository(() => testDb.db);

    expect(await repository.markAcked(await hashAckToken("token-a"), AFTER_TTL)).toBe(false);

    expect(await ackedAtFor("token-a")).toBeNull();
  });

  it("LINCHPIN: a replayed ack leaves the first ack's timestamp alone", async () => {
    const occurrenceId = await seedOccurrence("2026-08-18");
    const subscriptionId = await seedSubscription("https://push.example.com/a");
    await seedDelivery("token-a", occurrenceId, subscriptionId);
    const repository = new DrizzlePushDeliveryRepository(() => testDb.db);
    await repository.markAcked(await hashAckToken("token-a"), WITHIN_TTL);

    const later = new Date("2026-08-18T09:04:00Z");
    expect(await repository.markAcked(await hashAckToken("token-a"), later)).toBe(false);

    expect(await ackedAtFor("token-a")).toEqual(WITHIN_TTL);
  });

  it("refuses two deliveries with the same token hash", async () => {
    // The uniqueness is what lets the ack lookup be "the row", singular.
    const occurrenceId = await seedOccurrence("2026-08-18");
    const subscriptionA = await seedSubscription("https://push.example.com/a");
    const subscriptionB = await seedSubscription("https://push.example.com/b");
    await seedDelivery("token-a", occurrenceId, subscriptionA);

    await expect(seedDelivery("token-a", occurrenceId, subscriptionB)).rejects.toThrow();
  });

  it("registers one row per subscription in a single call", async () => {
    const occurrenceId = await seedOccurrence("2026-08-18");
    const subscriptionA = await seedSubscription("https://push.example.com/a");
    const subscriptionB = await seedSubscription("https://push.example.com/b");
    const repository = new DrizzlePushDeliveryRepository(() => testDb.db);

    await repository.registerSent([
      { careOccurrenceId: occurrenceId, pushSubscriptionId: subscriptionA, tokenHash: await hashAckToken("t-a"), sentAt: SENT_AT, expiresAt: EXPIRES_AT },
      { careOccurrenceId: occurrenceId, pushSubscriptionId: subscriptionB, tokenHash: await hashAckToken("t-b"), sentAt: SENT_AT, expiresAt: EXPIRES_AT },
    ]);

    const rows = await testDb.db.select().from(schema.pushDelivery).where(eq(schema.pushDelivery.careOccurrenceId, occurrenceId));
    expect(rows.map((r) => r.pushSubscriptionId).sort()).toEqual([subscriptionA, subscriptionB].sort());
  });

  it("registerSent with no rows issues no statement", async () => {
    // `db.insert(...).values([])` is a SQL syntax error, so the empty guard is
    // load-bearing: a user with zero subscriptions must not break the round.
    const repository = new DrizzlePushDeliveryRepository(() => testDb.db);

    await expect(repository.registerSent([])).resolves.toBeUndefined();
  });
});

describe("push_delivery when its subscription is pruned", () => {
  // A deliberate pair, not a redundant one: `ON DELETE cascade` fails only the
  // first test, and an FK with no delete rule at all fails only the second.
  // Merging them would leave one of the two mutations alive.

  it("LINCHPIN: keeps the rows and their ack evidence, with push_subscription_id NULL", async () => {
    // The 410-prune is exactly PR #107's incident (reinstalled PWA goes dark);
    // a cascade would delete the never-acked rows that are the evidence of it.
    // A acked, B not: an all-acked or all-unacked fixture lets a mutation
    // survive on the untested side.
    const occurrenceId = await seedOccurrence("2026-08-18");
    const subscriptionA = await seedSubscription("https://push.example.com/a");
    const subscriptionB = await seedSubscription("https://push.example.com/b");
    await seedDelivery("token-a", occurrenceId, subscriptionA);
    await seedDelivery("token-b", occurrenceId, subscriptionB);
    await new DrizzlePushDeliveryRepository(() => testDb.db).markAcked(await hashAckToken("token-a"), WITHIN_TTL);

    await testDb.db.delete(schema.pushSubscription);

    // Without this, a delete that matched nothing would make everything below
    // pass for the wrong reason — and cascade would not kill the test.
    expect(await testDb.db.select().from(schema.pushSubscription)).toHaveLength(0);
    const rows = await testDb.db.select().from(schema.pushDelivery).where(eq(schema.pushDelivery.careOccurrenceId, occurrenceId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.pushSubscriptionId)).toEqual([null, null]);
    expect(await ackedAtFor("token-a")).toEqual(WITHIN_TTL);
    expect(await ackedAtFor("token-b")).toBeNull();
  });

  it("lets the production prune path delete a subscription that still has delivery rows", async () => {
    // `deleteByEndpoint` has four callers, one of them the user-facing
    // unsubscribe route. With a NOT NULL FK and no delete rule this throws:
    // inside `dispatchSlot` it escapes before `recordAttempt` (the occurrence
    // then looks like an abandoned claim), and on unsubscribe it is a plain 500.
    const occurrenceId = await seedOccurrence("2026-08-18");
    const endpointA = "https://push.example.com/a";
    const subscriptionA = await seedSubscription(endpointA);
    await seedDelivery("token-a", occurrenceId, subscriptionA);

    await expect(new DrizzlePushSubscriptionRepository(() => testDb.db).deleteByEndpoint(USER_ID, endpointA)).resolves.toBeUndefined();

    expect(await testDb.db.select().from(schema.pushDelivery)).toHaveLength(1);
  });
});
