import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleExpenseGroupRepository } from "../../src/contexts/split/adapters/drizzle-expense-group-repository";
import { DrizzleSettlementRepository } from "../../src/contexts/split/adapters/drizzle-settlement-repository";
import { DrizzleSplitExpenseRepository } from "../../src/contexts/split/adapters/drizzle-split-expense-repository";
import { expenseGroup, expenseGroupMember, splitActivity, splitExpense, splitSettlement } from "../../src/shared/db/schema";
import { createTestDb, insertGroup, insertMember, insertUser, type TestDb } from "./harness";

/**
 * The eight write paths, against a real Postgres through the harness's `batch`
 * shim. Two claims per path, and they are different claims:
 *
 * 1. **The entry is written**, with enough in it to render — for a deletion,
 *    that means the amount and description of a row that no longer exists.
 * 2. **The entry and the change live or die together.** Proving (1) alone
 *    would leave the timeline free to record a change that was rolled back, or
 *    to miss one that landed. Each case here makes one of the two statements
 *    fail on a real constraint and asserts the other left nothing behind.
 *
 * Both directions are needed, and only one of them is easy. "The change failed,
 * so nothing was recorded" is also true of two writes issued one after another
 * — the second simply never runs. The direction that separates a batch from a
 * sequence is the other one: **the change must not survive its activity entry
 * failing**. That one has no natural trigger (there is no bad input that
 * breaks only the entry), so these cases add a `CHECK (false)` to
 * `split_activity` for the duration, which makes exactly one statement in the
 * batch fail and nothing else.
 *
 * The deletion paths get a third: an entry must not appear when the delete
 * matched no row. That case lives here, at the repository, and it cannot be
 * written one layer up — `deleteExpense`/`deleteSettlement` call `findById`
 * first and throw, so a use-case test never reaches the repository at all and
 * would pass just as happily against an unconditional insert.
 */
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const GHOST = "99999999-9999-9999-9999-999999999999";
const G = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const E1 = "e1111111-1111-1111-1111-111111111111";
const E2 = "e2222222-2222-2222-2222-222222222222";
const S1 = "51111111-1111-1111-1111-111111111111";
const S2 = "52222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-04-01T10:00:00.000Z");

describe("split activity writes (real Postgres)", () => {
  let harness: TestDb;
  let expenses: DrizzleSplitExpenseRepository;
  let settlements: DrizzleSettlementRepository;
  let groups: DrizzleExpenseGroupRepository;

  beforeAll(async () => {
    harness = await createTestDb();
    expenses = new DrizzleSplitExpenseRepository(() => harness.db);
    settlements = new DrizzleSettlementRepository(() => harness.db);
    groups = new DrizzleExpenseGroupRepository(() => harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    await insertUser(harness.db, A, "a@example.com", "Ann");
    await insertUser(harness.db, B, "b@example.com", "Ben");
    await insertUser(harness.db, C, "c@example.com", "Cid");
  });

  const activityRows = () => harness.db.select().from(splitActivity);

  /**
   * Runs `fn` with every insert into `split_activity` rejected by the
   * database, and asserts it threw. `NOT VALID` skips the existing rows, so
   * only new inserts hit it — the statement fails, the transaction it is part
   * of rolls back, and whatever else was in that transaction goes with it. Two
   * separate writes would leave the change standing.
   */
  async function withActivityWritesFailing(fn: () => Promise<unknown>): Promise<void> {
    await harness.db.execute(sql.raw("alter table split_activity add constraint tmp_activity_fails check (false) not valid"));
    try {
      await expect(fn()).rejects.toThrow();
    } finally {
      await harness.db.execute(sql.raw("alter table split_activity drop constraint tmp_activity_fails"));
    }
  }

  /** A groupless expense: payer A, B owes 300, recorded by B — actor, payer and share holder all different people. */
  const grouplessExpenseInput = {
    id: E1,
    groupId: null,
    payerUserId: A,
    createdByUserId: B,
    amount: 300,
    currency: "TWD",
    description: "Dinner",
    day: "2026-03-10",
    splitMode: "exact" as const,
    categoryName: null,
    shares: [{ userId: B, amount: 300 }],
  };

  describe("create expense", () => {
    it("records the creation, with the actor and the whole participant set as its audience", async () => {
      await expenses.create(grouplessExpenseInput, []);

      const [entry] = await activityRows();
      expect(entry).toMatchObject({
        type: "expense_created",
        actorUserId: B,
        groupId: null,
        subjectId: E1,
        amount: 300,
        currency: "TWD",
        description: "Dinner",
      });
      // B is both actor and share holder, and appears once.
      expect([...(entry?.audienceUserIds ?? [])].sort()).toEqual([A, B].sort());
    });

    it("leaves no entry when the expense's own write fails", async () => {
      await expect(
        expenses.create({ ...grouplessExpenseInput, shares: [{ userId: B, amount: -300 }] }, []),
      ).rejects.toThrow();

      expect(await activityRows()).toHaveLength(0);
      expect(await harness.db.select().from(splitExpense)).toHaveLength(0);
    });

    it("does not create the expense when the activity write fails", async () => {
      await withActivityWritesFailing(() => expenses.create(grouplessExpenseInput, []));

      expect(await harness.db.select().from(splitExpense)).toHaveLength(0);
    });
  });

  describe("update expense", () => {
    it("records both the previous and the new amount", async () => {
      await expenses.create(grouplessExpenseInput, []);
      await expenses.update(
        E1,
        { payerUserId: A, amount: 500, currency: "TWD", description: "Dinner and drinks", day: "2026-03-10", splitMode: "exact", categoryName: null, shares: [{ userId: B, amount: 500 }] },
        [],
        NOW,
        A,
      );

      const [entry] = (await activityRows()).filter((row) => row.type === "expense_updated");
      expect(entry).toMatchObject({ actorUserId: A, subjectId: E1, amount: 500, previousAmount: 300, description: "Dinner and drinks" });
    });

    it("records the previous amount even when the edit left the amount alone", async () => {
      // The contract is "always recorded" (design.md D6), not "recorded when
      // it moved": a client reading `previous_amount != null` as "the amount
      // changed" would be wrong on every edit, and this pins the real
      // behaviour so the doc comments cannot drift back to the old claim.
      await expenses.create(grouplessExpenseInput, []);
      await expenses.update(
        E1,
        { payerUserId: A, amount: 300, currency: "TWD", description: "Dinner, renamed", day: "2026-03-10", splitMode: "exact", categoryName: null, shares: [{ userId: B, amount: 300 }] },
        [],
        NOW,
        A,
      );

      const [entry] = (await activityRows()).filter((row) => row.type === "expense_updated");
      expect(entry).toMatchObject({ amount: 300, previousAmount: 300, description: "Dinner, renamed" });
    });

    it("gives the entry everyone who participated before OR after the edit", async () => {
      // The edit drops B and puts C in their place. B's balance just changed
      // and B is no longer anywhere in the expense — if the audience were the
      // new participants only, the one person the edit took money off would be
      // the one person never told.
      await expenses.create(grouplessExpenseInput, []);
      await expenses.update(
        E1,
        { payerUserId: A, amount: 300, currency: "TWD", description: "Dinner", day: "2026-03-10", splitMode: "exact", categoryName: null, shares: [{ userId: C, amount: 300 }] },
        [],
        NOW,
        A,
      );

      const [entry] = (await activityRows()).filter((row) => row.type === "expense_updated");
      expect([...(entry?.audienceUserIds ?? [])].sort()).toEqual([A, B, C].sort());
    });

    it("leaves no entry when the edit's own write fails", async () => {
      await expenses.create(grouplessExpenseInput, []);
      await expect(
        expenses.update(
          E1,
          { payerUserId: A, amount: 500, currency: "TWD", description: "Broken", day: "2026-03-10", splitMode: "exact", categoryName: null, shares: [{ userId: B, amount: -500 }] },
          [],
          NOW,
          A,
        ),
      ).rejects.toThrow();

      expect((await activityRows()).filter((row) => row.type === "expense_updated")).toHaveLength(0);
      const [row] = await harness.db.select().from(splitExpense).where(eq(splitExpense.id, E1));
      expect(row?.amount).toBe(300);
    });

    it("does not apply the edit when the activity write fails", async () => {
      await expenses.create(grouplessExpenseInput, []);
      await withActivityWritesFailing(() =>
        expenses.update(
          E1,
          { payerUserId: A, amount: 500, currency: "TWD", description: "Dinner and drinks", day: "2026-03-10", splitMode: "exact", categoryName: null, shares: [{ userId: B, amount: 500 }] },
          [],
          NOW,
          A,
        ),
      );

      const [row] = await harness.db.select().from(splitExpense).where(eq(splitExpense.id, E1));
      expect(row?.amount).toBe(300);
      expect(row?.description).toBe("Dinner");
    });
  });

  describe("delete expense", () => {
    it("keeps the deleted expense readable — amount, description, and who could see it", async () => {
      await expenses.create(grouplessExpenseInput, []);
      await harness.db.delete(splitActivity);

      expect(await expenses.delete(E1, A, NOW)).toBe(true);

      const [entry] = await activityRows();
      expect(entry).toMatchObject({ type: "expense_deleted", actorUserId: A, groupId: null, subjectId: E1, amount: 300, currency: "TWD", description: "Dinner" });
      // The shares that named B cascaded away with the expense; this array is
      // now the only record that B was in it. It also pins the statement
      // ordering: run the insert after the delete instead and it would select
      // from an already-empty table and write nothing at all.
      expect([...(entry?.audienceUserIds ?? [])].sort()).toEqual([A, B].sort());
      expect(await harness.db.select().from(splitExpense)).toHaveLength(0);
    });

    it("records nothing when the delete matches no row", async () => {
      // A *different* expense exists throughout. Without it the table is empty
      // and an insert that had lost its `where id = ?` — selecting every
      // expense there is — would still write nothing, and this case would pass
      // against exactly the bug it is here to catch.
      await expenses.create({ ...grouplessExpenseInput, id: E2, description: "Someone else's" }, []);
      await harness.db.delete(splitActivity);

      expect(await expenses.delete(E1, A, NOW)).toBe(false);
      expect(await activityRows()).toHaveLength(0);
    });

    it("does not delete the expense when the activity write fails", async () => {
      await expenses.create(grouplessExpenseInput, []);
      await withActivityWritesFailing(() => expenses.delete(E1, A, NOW));

      expect(await harness.db.select().from(splitExpense).where(eq(splitExpense.id, E1))).toHaveLength(1);
    });

    it("takes its audience from the group instead when the expense had one", async () => {
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);
      await insertMember(harness.db, G, B);
      await expenses.create({ ...grouplessExpenseInput, groupId: G }, []);
      await harness.db.delete(splitActivity);

      await expenses.delete(E1, A, NOW);

      const [entry] = await activityRows();
      expect(entry?.groupId).toBe(G);
      // Null, not a copy of today's members: the group outlives the expense,
      // so its live membership stays the answer (design.md D2).
      expect(entry?.audienceUserIds).toBeNull();
    });
  });

  describe("create settlement", () => {
    const settlementInput = { id: S1, groupId: null, fromUserId: B, toUserId: A, amount: 200, currency: "JPY", day: "2026-03-11", note: null, createdByUserId: A };

    it("records the repayment and names the actor's counterpart", async () => {
      await settlements.create(settlementInput);

      const [entry] = await activityRows();
      expect(entry).toMatchObject({ type: "settlement_created", actorUserId: A, subjectId: S1, counterpartUserId: B, amount: 200, currency: "JPY" });
      expect([...(entry?.audienceUserIds ?? [])].sort()).toEqual([A, B].sort());
    });

    /**
     * The two repayments below are identical in **every other column** — same
     * actor, same counterpart, same amount, same currency, same audience — and
     * they are opposite events: "Ann paid Ben 200" and "Ben paid Ann 200".
     * Without `actor_is_payer` the two entries are byte-identical, and a
     * timeline that cannot tell a debt paid from a debt received is not a
     * record of repayments at all.
     */
    it("records which way the money went, so two opposite repayments are not the same entry", async () => {
      await settlements.create({ ...settlementInput, id: S1, fromUserId: A, toUserId: B, createdByUserId: A });
      await settlements.create({ ...settlementInput, id: S2, fromUserId: B, toUserId: A, createdByUserId: A });

      const bySubject = new Map((await activityRows()).map((row) => [row.subjectId, row]));
      expect(bySubject.get(S1)).toMatchObject({ actorUserId: A, counterpartUserId: B, actorIsPayer: true });
      expect(bySubject.get(S2)).toMatchObject({ actorUserId: A, counterpartUserId: B, actorIsPayer: false });
    });

    it("leaves no entry when the settlement's own write fails", async () => {
      // `split_settlement_not_self`: paying yourself is not a repayment.
      await expect(settlements.create({ ...settlementInput, fromUserId: A, toUserId: A })).rejects.toThrow();

      expect(await activityRows()).toHaveLength(0);
      expect(await harness.db.select().from(splitSettlement)).toHaveLength(0);
    });

    it("does not create the settlement when the activity write fails", async () => {
      await withActivityWritesFailing(() => settlements.create(settlementInput));

      expect(await harness.db.select().from(splitSettlement)).toHaveLength(0);
    });
  });

  describe("delete settlement", () => {
    const settlementInput = { id: S1, groupId: null, fromUserId: B, toUserId: A, amount: 200, currency: "JPY", day: "2026-03-11", note: null, createdByUserId: A };

    it("keeps the deleted repayment readable", async () => {
      await settlements.create(settlementInput);
      await harness.db.delete(splitActivity);

      expect(await settlements.delete(S1, A, NOW)).toBe(true);

      const [entry] = await activityRows();
      expect(entry).toMatchObject({ type: "settlement_deleted", actorUserId: A, subjectId: S1, counterpartUserId: B, amount: 200, currency: "JPY" });
      expect([...(entry?.audienceUserIds ?? [])].sort()).toEqual([A, B].sort());
      expect(await harness.db.select().from(splitSettlement)).toHaveLength(0);
    });

    /**
     * The direction after the fact. This is the case that cannot be repaired
     * later: once the settlement row is gone, `from_user_id`/`to_user_id` are
     * gone with it, so a second request cannot recover which way the money
     * went. Both directions are deleted here, so an entry that hardcoded one
     * of them fails on the other.
     */
    it("keeps the direction of a deleted repayment, both ways round", async () => {
      await settlements.create({ ...settlementInput, id: S1, fromUserId: A, toUserId: B, createdByUserId: A });
      await settlements.create({ ...settlementInput, id: S2, fromUserId: B, toUserId: A, createdByUserId: A });
      await harness.db.delete(splitActivity);

      expect(await settlements.delete(S1, A, NOW)).toBe(true);
      expect(await settlements.delete(S2, A, NOW)).toBe(true);

      const bySubject = new Map((await activityRows()).map((row) => [row.subjectId, row]));
      expect(bySubject.get(S1)).toMatchObject({ type: "settlement_deleted", actorUserId: A, counterpartUserId: B, actorIsPayer: true });
      expect(bySubject.get(S2)).toMatchObject({ type: "settlement_deleted", actorUserId: A, counterpartUserId: B, actorIsPayer: false });
      expect(await harness.db.select().from(splitSettlement)).toHaveLength(0);
    });

    it("records nothing when the delete matches no row", async () => {
      // Another settlement exists throughout, for the same reason as the
      // expense case: an insert that had lost its `where id = ?` must have
      // something to wrongly pick up.
      await settlements.create({ ...settlementInput, id: S2, fromUserId: C, toUserId: A, createdByUserId: C });
      await harness.db.delete(splitActivity);

      expect(await settlements.delete(S1, A, NOW)).toBe(false);
      expect(await activityRows()).toHaveLength(0);
    });

    it("does not delete the settlement when the activity write fails", async () => {
      await settlements.create(settlementInput);
      await withActivityWritesFailing(() => settlements.delete(S1, A, NOW));

      expect(await harness.db.select().from(splitSettlement).where(eq(splitSettlement.id, S1))).toHaveLength(1);
    });
  });

  describe("create group", () => {
    it("records the creation against the new group", async () => {
      const group = await groups.create({ name: "Trip", createdByUserId: A });

      const [entry] = await activityRows();
      expect(entry).toMatchObject({ type: "group_created", actorUserId: A, groupId: group.id, subjectId: group.id });
      expect(entry?.audienceUserIds).toBeNull();
    });

    it("leaves no entry when the group's own write fails", async () => {
      await expect(groups.create({ name: "Trip", createdByUserId: GHOST })).rejects.toThrow();

      expect(await activityRows()).toHaveLength(0);
      expect(await harness.db.select().from(expenseGroup)).toHaveLength(0);
    });

    it("does not create the group when the activity write fails", async () => {
      await withActivityWritesFailing(() => groups.create({ name: "Trip", createdByUserId: A }));

      expect(await harness.db.select().from(expenseGroup)).toHaveLength(0);
      expect(await harness.db.select().from(expenseGroupMember)).toHaveLength(0);
    });
  });

  describe("add group member", () => {
    it("records who was added and who added them", async () => {
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);

      await groups.addMember(G, B, NOW, A);

      const [entry] = await activityRows();
      expect(entry).toMatchObject({ type: "group_member_added", actorUserId: A, groupId: G, counterpartUserId: B });
      expect(entry?.audienceUserIds).toBeNull();
    });

    it("leaves no entry when the membership write fails", async () => {
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);
      await insertMember(harness.db, G, B);

      // `expense_group_member_group_id_user_id_unique`: B is already in.
      await expect(groups.addMember(G, B, NOW, A)).rejects.toThrow();

      expect(await activityRows()).toHaveLength(0);
      expect(await harness.db.select().from(expenseGroupMember)).toHaveLength(2);
    });

    it("does not add the member when the activity write fails", async () => {
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);

      await withActivityWritesFailing(() => groups.addMember(G, B, NOW, A));

      expect(await harness.db.select().from(expenseGroupMember)).toHaveLength(1);
    });
  });

  describe("archive group", () => {
    it("records the archiving", async () => {
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);

      expect(await groups.archive(G, NOW, A)).toBe(true);

      const [entry] = await activityRows();
      expect(entry).toMatchObject({ type: "group_archived", actorUserId: A, groupId: G, subjectId: G });
    });

    /**
     * Archiving is one-way, so the second call is not "the same event again",
     * it is no event at all — a double-tapped archive button must not make the
     * timeline say the group was archived twice.
     *
     * This lives at the repository, not at `archiveGroup`: the use case reads
     * the group first and cannot tell an already-archived group from a fresh
     * one without asking the database, so a test one layer up passes just as
     * happily against an UPDATE that matches the row every time.
     */
    it("archives once: a second call writes nothing and says it did nothing", async () => {
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);
      const LATER = new Date("2026-04-02T10:00:00.000Z");

      expect(await groups.archive(G, NOW, A)).toBe(true);
      expect(await groups.archive(G, LATER, A)).toBe(false);

      expect((await activityRows()).filter((row) => row.type === "group_archived")).toHaveLength(1);
      // And the first archiving is the one that stands: the second call must
      // not quietly move `archived_at` forward either.
      const [group] = await harness.db.select().from(expenseGroup).where(eq(expenseGroup.id, G));
      expect(group?.archivedAt?.toISOString()).toBe(NOW.toISOString());
    });

    it("does not archive the group when the activity write fails", async () => {
      // The UPDATE itself cannot fail — a group is never deleted, so its row
      // is always there. (It can still match *nothing*, which is the
      // already-archived case above; that is what the conditional insert is
      // for, and it is not what this case is about.)
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);

      await withActivityWritesFailing(() => groups.archive(G, NOW, A));

      const [group] = await harness.db.select().from(expenseGroup).where(eq(expenseGroup.id, G));
      expect(group?.archivedAt).toBeNull();
      expect(await activityRows()).toHaveLength(0);
    });
  });

  /**
   * **This is NOT a concurrency test, and must not be read as one.**
   *
   * The three conditional `INSERT ... SELECT`s (expense delete, settlement
   * delete, group archive) are each in a `db.batch`, which on neon-http is one
   * **READ COMMITTED** transaction — and in READ COMMITTED every statement
   * takes its *own* snapshot. The condition alone therefore narrows the ghost
   * activity race without closing it: the INSERT can still see the source row
   * while the DELETE/UPDATE after it, re-evaluated once a concurrent
   * transaction commits, matches nothing. The entry is committed, `false` goes
   * back, the caller gets a 404 for a change the timeline says happened. For
   * `archive` the mirror image is worse: two concurrent *first* archives both
   * insert, and the timeline says the group was archived twice.
   *
   * `for update` on the source SELECT is the fix — it makes the INSERT take the
   * row lock, so the following statement cannot be raced.
   *
   * **The suite cannot prove that.** PGlite is a single connection with no
   * second session (harness.ts, isolation strategy), so two of these
   * transactions can never overlap here; a test that ran both deletes in a row
   * would pass identically with the lock removed, which is worse than no test.
   * What is checkable is the *emitted SQL*, and that is all this case claims:
   * the statement really carries the lock, on the right relation. Whether the
   * lock then closes the race is Postgres' documented READ COMMITTED behaviour,
   * argued in the repository comments — not demonstrated by anything here.
   */
  describe("the ghost-activity race", () => {
    /** Runs `fn` against the real harness db, returning every raw SQL string it executed. */
    async function recordSql(fn: (db: TestDb["db"]) => Promise<unknown>): Promise<string[]> {
      const dialect = new PgDialect();
      const statements: string[] = [];
      const recording = new Proxy(harness.db as object, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") return value;
          if (prop === "execute") {
            return (query: SQL) => {
              statements.push(dialect.sqlToQuery(query).sql);
              return (value as (q: SQL) => unknown).call(target, query);
            };
          }
          return value.bind(target);
        },
      }) as TestDb["db"];
      await fn(recording);
      return statements;
    }

    it("the emitted SQL takes a row lock on the row the entry is about", async () => {
      await expenses.create(grouplessExpenseInput, []);
      await settlements.create({ id: S1, groupId: null, fromUserId: B, toUserId: A, amount: 200, currency: "JPY", day: "2026-03-11", note: null, createdByUserId: A });
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);

      const expenseSql = await recordSql((db) => new DrizzleSplitExpenseRepository(() => db).delete(E1, A, NOW));
      const settlementSql = await recordSql((db) => new DrizzleSettlementRepository(() => db).delete(S1, A, NOW));
      const groupSql = await recordSql((db) => new DrizzleExpenseGroupRepository(() => db).archive(G, NOW, A));

      // `of <alias>` matters as much as `for update` does: the lock has to name
      // the source row of the entry, not whatever else the planner reaches.
      expect(expenseSql.find((s) => s.includes("insert into") && s.includes("expense_deleted"))).toMatch(/for update of\s+"?e"?/i);
      expect(settlementSql.find((s) => s.includes("insert into") && s.includes("settlement_deleted"))).toMatch(/for update of\s+"?s"?/i);
      expect(groupSql.find((s) => s.includes("insert into") && s.includes("group_archived"))).toMatch(/for update of\s+"?g"?/i);
    });
  });

  /**
   * **One clock and one resolution across all eight paths**, because the
   * timeline's cursor is `<createdAt.toISOString()>|<id>` — a JS `Date`, i.e.
   * milliseconds. A row whose `created_at` came from Postgres' `now()` carries
   * microseconds instead; the cursor built from it is *rounded down*, sorts
   * above the rows below it, and those rows are then unreachable by any page,
   * permanently. That is what an omitted `created_at` in the two deletes'
   * `INSERT ... SELECT` produced on Neon.
   *
   * This cannot be reproduced through the database clock here: PGlite's `now()`
   * is millisecond-resolution (harness.ts boundary 2 — PGlite is not Neon), so
   * a lossy row would look identical to a good one. The property is asserted
   * directly instead: **the stored `created_at` is the exact `Date` the caller
   * supplied** — a fixed instant months in the past with a non-zero millisecond
   * component, which no database `now()` can produce and no rounding survives.
   *
   * The five paths that are *handed* a `now` compare the stored value against
   * it directly. **The three creates take their own `new Date()`, and are
   * covered too — but not by any clock trick.** Two obvious attempts do not
   * work here, and both have already been tried:
   *
   * - *Freezing the clock.* PGlite's `now()` **follows the JS clock**, so
   *   `vi.setSystemTime` moves the database's clock along with `new Date()`.
   *   The two candidate sources stay identical and nothing is separated.
   * - *Comparing against a sibling row in the same batch.* Every statement in
   *   one transaction sees the same `now()`, so a `defaultNow()` entry and a
   *   sibling written from `defaultNow()` would agree just as well as two rows
   *   written from the caller's `Date`.
   *
   * What separates them is not a clock but a **delay**: `withDelayedBatch`
   * wraps the injected `Db` seam so `batch` sleeps ~60ms before delegating.
   * The `Date` a `create` captures is taken *before* it builds its statements,
   * i.e. before the sleep; the transaction — and therefore any `defaultNow()`
   * — starts after it. The two sources are then ~60ms apart, which is orders
   * of magnitude more than their skew, and the assertions below pin both ends:
   * the entry equals the exact `Date` the `create` returned, and it sits well
   * before the transaction began. Deleting `createdAt: now` from any of the
   * three create activity inserts reddens exactly one of these cases, every
   * run. Do not delete them for being untestable — they are not.
   */
  describe("created_at", () => {
    const CALLER_NOW = new Date("2026-04-01T10:00:00.123Z");
    const settlementInput = { id: S1, groupId: null, fromUserId: B, toUserId: A, amount: 200, currency: "JPY", day: "2026-03-11", note: null, createdByUserId: A };
    const editedFields = { payerUserId: A, amount: 500, currency: "TWD", description: "Dinner and drinks", day: "2026-03-10", splitMode: "exact" as const, categoryName: null, shares: [{ userId: B, amount: 500 }] };

    /** The one entry of `type`, and the claim: exactly the caller's instant, to the millisecond, with nothing below it. */
    async function expectCallerClock(type: string): Promise<Date> {
      const [entry] = (await activityRows()).filter((row) => row.type === type);
      expect(entry, `no ${type} entry was written`).toBeDefined();
      expect(entry?.createdAt.toISOString()).toBe(CALLER_NOW.toISOString());
      return entry?.createdAt as Date;
    }

    it("expense update", async () => {
      await expenses.create(grouplessExpenseInput, []);
      await expenses.update(E1, editedFields, [], CALLER_NOW, A);
      await expectCallerClock("expense_updated");
    });

    it("expense delete", async () => {
      await expenses.create(grouplessExpenseInput, []);
      await expenses.delete(E1, A, CALLER_NOW);

      // The path where leaving `created_at` out is silent: it is built with
      // `INSERT ... SELECT`, the column has a `defaultNow()`, and every other
      // assertion about the entry's contents passes either way.
      await expectCallerClock("expense_deleted");
    });

    it("settlement delete", async () => {
      await settlements.create(settlementInput);
      await settlements.delete(S1, A, CALLER_NOW);
      await expectCallerClock("settlement_deleted");
    });

    it("group member added", async () => {
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);
      await groups.addMember(G, B, CALLER_NOW, A);
      await expectCallerClock("group_member_added");
    });

    it("group archived", async () => {
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);
      await groups.archive(G, CALLER_NOW, A);
      await expectCallerClock("group_archived");
    });

    /**
     * Long enough to dwarf any skew between the two candidate clocks (which is
     * sub-millisecond here — see the block comment above), short enough that
     * three cases cost less than a fifth of a second.
     */
    const BATCH_DELAY_MS = 60;

    /**
     * Runs `fn` with the `Db` the repositories were injected with delaying
     * every `batch` by `BATCH_DELAY_MS`, and reports the instant the
     * transaction actually started. A `create` captures its `Date` before
     * building its statements, so that `Date` is a full delay *older* than
     * anything the database's own clock can produce inside the batch.
     */
    async function withDelayedBatch<T>(fn: () => Promise<T>): Promise<{ result: T; transactionStartedAt: Date }> {
      const target = harness.db as unknown as { batch: (queries: PromiseLike<unknown>[]) => Promise<unknown[]> };
      const original = target.batch;
      const captured: { at: Date | null } = { at: null };
      target.batch = async (queries) => {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        captured.at = new Date();
        return original.call(target, queries);
      };
      let result: T;
      try {
        result = await fn();
      } finally {
        target.batch = original;
      }
      const transactionStartedAt = captured.at;
      // Without this the whole technique could silently no-op — an unwrapped
      // `batch` leaves the two clocks a fraction of a millisecond apart and
      // every assertion below passes against the bug.
      if (!transactionStartedAt) throw new Error("the delayed batch never ran; this case proves nothing");
      return { result, transactionStartedAt };
    }

    /** The entry of `type` carries the `Date` the create captured, and that `Date` predates the transaction. */
    async function expectPreBatchClock(type: string, returnedCreatedAt: Date, transactionStartedAt: Date): Promise<void> {
      const [entry] = (await activityRows()).filter((row) => row.type === type);
      expect(entry, `no ${type} entry was written`).toBeDefined();
      const createdAt = entry?.createdAt as Date;
      expect(createdAt.toISOString()).toBe(returnedCreatedAt.toISOString());
      // And it is the pre-batch instant specifically, not merely equal to a
      // sibling that might have taken `defaultNow()` alongside it.
      expect(transactionStartedAt.getTime() - createdAt.getTime()).toBeGreaterThanOrEqual(BATCH_DELAY_MS / 2);
    }

    it("expense create", async () => {
      const { result: expense, transactionStartedAt } = await withDelayedBatch(() => expenses.create(grouplessExpenseInput, []));
      await expectPreBatchClock("expense_created", expense.createdAt, transactionStartedAt);
    });

    it("settlement create", async () => {
      const { result: settlement, transactionStartedAt } = await withDelayedBatch(() => settlements.create(settlementInput));
      await expectPreBatchClock("settlement_created", settlement.createdAt, transactionStartedAt);
    });

    it("group create", async () => {
      const { result: group, transactionStartedAt } = await withDelayedBatch(() => groups.create({ name: "Trip", createdByUserId: A }));
      await expectPreBatchClock("group_created", group.createdAt, transactionStartedAt);
    });
  });
});
