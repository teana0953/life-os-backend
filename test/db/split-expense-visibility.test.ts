import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleSplitExpenseRepository } from "../../src/contexts/split/adapters/drizzle-split-expense-repository";
import { createTestDb, insertExpense, insertGroup, insertMember, insertUser, type TestDb } from "./harness";

/**
 * `listForUser`'s visibility WHERE, executed against a real Postgres. Getting
 * this wrong leaks other people's expenses wholesale, and until now no test
 * ever ran the predicate — the fake `Db` throws `where()` away.
 *
 * World (rebuilt before each case):
 *   users A, B, C, D; group G = {A, B, C}; D is in no group.
 *   E1  groupless, payer A, 300 TWD, shares: B 300      <- pure advance: the
 *                                                          payer holds no
 *                                                          share of their own
 *   E2  in G,      payer A, 900 TWD, shares: A 300, B 300  <- C holds none
 *   E4  in G,      payer B, 200 TWD, shares: A 200         <- C holds none
 *   E5  groupless, payer D, 100 TWD, shares: D 100         <- D's own world
 *   E6  groupless, payer A, 70 TWD,  shares: A 70          <- A alone: the
 *                                                             counter-example
 *                                                             `with=B` must
 *                                                             NOT return
 *   E7  groupless, payer B, 90 TWD,  shares: B 90          <- B alone: the
 *                                                             mirror
 *                                                             counter-example
 */
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";
const G = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const G2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const E1 = "e1111111-1111-1111-1111-111111111111";
const E2 = "e2222222-2222-2222-2222-222222222222";
const E4 = "e4444444-4444-4444-4444-444444444444";
const E5 = "e5555555-5555-5555-5555-555555555555";
const E6 = "e6666666-6666-6666-6666-666666666666";
const E7 = "e7777777-7777-7777-7777-777777777777";
const E8 = "e8888888-8888-8888-8888-888888888888";

describe("DrizzleSplitExpenseRepository.listForUser visibility (real Postgres)", () => {
  let harness: TestDb;
  let repo: DrizzleSplitExpenseRepository;

  beforeAll(async () => {
    harness = await createTestDb();
    repo = new DrizzleSplitExpenseRepository(() => harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    const db = harness.db;
    await insertUser(db, A, "a@example.com", "Ann");
    await insertUser(db, B, "b@example.com", "Ben");
    await insertUser(db, C, "c@example.com", "Cid");
    await insertUser(db, D, "d@example.com", "Dee");
    await insertGroup(db, G, "Trip", A);
    await insertMember(db, G, A);
    await insertMember(db, G, B);
    await insertMember(db, G, C);
    await insertExpense(db, { id: E1, payerUserId: A, amount: 300, shares: [{ userId: B, amount: 300 }] });
    await insertExpense(db, {
      id: E2,
      groupId: G,
      payerUserId: A,
      amount: 900,
      shares: [
        { userId: A, amount: 300 },
        { userId: B, amount: 300 },
      ],
    });
    await insertExpense(db, { id: E4, groupId: G, payerUserId: B, amount: 200, shares: [{ userId: A, amount: 200 }] });
    // A second group, same members. Without it, `group_id=` widened from
    // "this group" to "any group at all" stays green, because every grouped
    // expense in the world belongs to G — the predicate is proven to exist
    // but not to name the group that was asked for.
    await insertGroup(db, G2, "Other trip", A);
    await insertMember(db, G2, A);
    await insertMember(db, G2, B);
    await insertExpense(db, { id: E8, groupId: G2, payerUserId: B, amount: 150, shares: [{ userId: A, amount: 150 }] });
    await insertExpense(db, { id: E5, payerUserId: D, amount: 100, shares: [{ userId: D, amount: 100 }] });
    await insertExpense(db, { id: E6, payerUserId: A, amount: 70, shares: [{ userId: A, amount: 70 }] });
    await insertExpense(db, { id: E7, payerUserId: B, amount: 90, shares: [{ userId: B, amount: 90 }] });
  });

  const ids = async (userId: string, filter: Parameters<typeof repo.listForUser>[1] = {}) =>
    (await repo.listForUser(userId, filter)).map((expense) => expense.id).sort();

  // 2.1 — the reverse case: a non-participant, non-member sees none of it.
  it("excludes expenses the caller neither pays, holds a share in, nor is a group member of", async () => {
    expect(await ids(D)).toEqual([E5]);
  });

  // 2.2 — pure advance (E1): B holds the only share, A is payer with none.
  it("shows an expense to its share holder and to its payer", async () => {
    expect(await ids(B)).toContain(E1);
    expect(await ids(A)).toContain(E1);
  });

  // 2.3 — the membership EXISTS; it exists because of a past bug where the
  // unfiltered listing and the ?group_id= listing disagreed.
  it("shows group expenses to a member holding no share in them", async () => {
    expect(await ids(C)).toEqual([E2, E4].sort());
  });

  // 2.4 — both halves of the branch bite here: E2/E4 are grouped (so the
  // `group_id IS NULL` half excludes them), and E6 is groupless but B has
  // nothing to do with it (so the *counterpart* participation half excludes
  // it), and E7 is groupless but A has nothing to do with it (so the caller's
  // own participation half excludes it). E6 and E7 are mirror
  // counter-examples and both are needed: without E6 a query that ignores the
  // counterpart passes — the "list every groupless expense of mine to whoever
  // asks" leak; without E7 a query that ignores the caller passes — the worse
  // one, handing B's private expenses to anyone who asks for `with=B`.
  it("with= returns only groupless expenses both sides participate in", async () => {
    expect(await ids(A, { withUserId: B })).toEqual([E1]);
  });

  // 2.5
  it("group_id= returns every expense in that group", async () => {
    expect(await ids(A, { groupId: G })).toEqual([E2, E4].sort());
  });
});
