import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleBalanceRepository } from "../../src/contexts/split/adapters/drizzle-balance-repository";
import type { Balance } from "../../src/contexts/split/domain/balance";
import { createTestDb, insertExpense, insertGroup, insertMember, insertSettlement, insertUser, type TestDb } from "./harness";

/**
 * `balancesForUser` / `balancesForGroup` executed against a real Postgres.
 * These are the money figures, and the settlement sign direction in
 * particular took three design rounds and two blocking review findings with
 * no executable evidence behind it — a group's zero-sum invariant holds under
 * either sign, so it can never prove direction. Every assertion below is on a
 * **signed amount for a named counterpart**; zero-sum is only ever an extra
 * check.
 *
 * One thing here is unprovable rather than untested: in `balancesForGroup`,
 * dropping `ss.user_id != se.payer_user_id` from the two expense legs cannot
 * be made to fail. Those legs read the same rows and key them on the same
 * counterpart, so a payer's own share contributes `+amount` on one leg and
 * `-amount` on the other and cancels exactly, for every row and every
 * currency. The predicate is redundant there (unlike in `balancesForUser`,
 * where the legs key on *different* counterparts and 3.4 does catch it).
 * No fixture can kill it; do not add a test chasing it.
 */
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const G = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const G2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const EXPENSE_1 = "e1111111-1111-1111-1111-111111111111";
const EXPENSE_2 = "e2222222-2222-2222-2222-222222222222";
const EXPENSE_3 = "e3333333-3333-3333-3333-333333333333";
const EXPENSE_4 = "e4444444-4444-4444-4444-444444444444";
const SETTLEMENT_1 = "f1111111-1111-1111-1111-111111111111";
const SETTLEMENT_2 = "f2222222-2222-2222-2222-222222222222";
const SETTLEMENT_3 = "f3333333-3333-3333-3333-333333333333";
const SETTLEMENT_4 = "f4444444-4444-4444-4444-444444444444";

/** The signed amount `balances` holds against `userId` in `currency`, or undefined when the pair/currency does not appear at all. */
function amountAgainst(balances: Balance[], userId: string, currency = "TWD"): number | undefined {
  return balances.find((balance) => balance.userId === userId)?.balances.find((entry) => entry.currency === currency)?.amount;
}

describe("DrizzleBalanceRepository (real Postgres)", () => {
  let harness: TestDb;
  let repo: DrizzleBalanceRepository;

  beforeAll(async () => {
    harness = await createTestDb();
    repo = new DrizzleBalanceRepository(() => harness.db);
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

  // 3.1 — signed values in both directions, from one and the same expense.
  // A's side is asserted whole rather than through `amountAgainst`, because
  // that helper reads only `userId` and `amount` and so cannot see the
  // `JOIN users` that supplies the counterpart's name: joining on the wrong
  // column duplicates every row under a stranger's name and the helper still
  // finds the right first amount.
  it("nets an expense as positive for the payer and negative for the share holder", async () => {
    await insertExpense(harness.db, { id: EXPENSE_1, payerUserId: A, amount: 450, shares: [{ userId: B, amount: 450 }] });

    expect(await repo.balancesForUser(A)).toEqual([{ userId: B, displayName: "Ben", balances: [{ currency: "TWD", amount: 450 }] }]);
    expect(amountAgainst(await repo.balancesForUser(B), A)).toBe(-450);
  });

  // The mirror of the group-scoping case below: that one proves
  // `balancesForGroup` counts only its own group, and nothing proved
  // `balancesForUser` counts **everything**. Adding `group_id IS NULL` to any
  // of its four legs was green across the whole file — the personal balance
  // screen would have silently dropped every group expense and every group
  // repayment, which is exactly what the source comment says it must not do.
  it("nets grouped expenses and grouped settlements alike, not just groupless ones", async () => {
    await insertGroup(harness.db, G, "Trip", A);
    await insertMember(harness.db, G, A);
    await insertMember(harness.db, G, B);
    await insertExpense(harness.db, {
      id: EXPENSE_1,
      groupId: G,
      payerUserId: A,
      amount: 450,
      shares: [{ userId: B, amount: 450 }],
    });
    await insertSettlement(harness.db, { id: SETTLEMENT_1, groupId: G, fromUserId: B, toUserId: A, amount: 300 });

    expect(amountAgainst(await repo.balancesForUser(A), B)).toBe(150);
    expect(amountAgainst(await repo.balancesForUser(B), A)).toBe(-150);
  });

  // 3.2 — the settlement direction, personal (groupless) query.
  describe("a repayment moves the balance toward zero", () => {
    beforeEach(async () => {
      await insertExpense(harness.db, { id: EXPENSE_1, payerUserId: A, amount: 450, shares: [{ userId: B, amount: 450 }] });
    });

    it("leaves 150 after B repays 300 of 450", async () => {
      await insertSettlement(harness.db, { id: SETTLEMENT_1, fromUserId: B, toUserId: A, amount: 300 });

      expect(amountAgainst(await repo.balancesForUser(A), B)).toBe(150);
      expect(amountAgainst(await repo.balancesForUser(B), A)).toBe(-150);
    });

    it("drops the pair entirely once repaid in full", async () => {
      await insertSettlement(harness.db, { id: SETTLEMENT_1, fromUserId: B, toUserId: A, amount: 450 });

      expect(await repo.balancesForUser(A)).toEqual([]);
      expect(await repo.balancesForUser(B)).toEqual([]);
    });

    it("flips the sign when B overpays", async () => {
      await insertSettlement(harness.db, { id: SETTLEMENT_1, fromUserId: B, toUserId: A, amount: 600 });

      expect(amountAgainst(await repo.balancesForUser(A), B)).toBe(-150);
      expect(amountAgainst(await repo.balancesForUser(B), A)).toBe(150);
    });
  });

  // 3.3 — the group query, including a settlement *inside the group*: without
  // one, swapping the group settlement's signs changes nothing and the
  // direction stays unproven.
  //
  // It also seeds groupless money between the very same three people, which
  // the group figures must ignore entirely. That noise is what proves the
  // `group_id = <this group>` scoping on all four legs: without it, dropping
  // the scope from either the expense legs or the settlement legs changes no
  // assertion, and a group's balance screen would silently absorb its
  // members' personal expenses with each other.
  it("nets each member against the whole group, settlements included", async () => {
    await insertGroup(harness.db, G, "Trip", A);
    await insertMember(harness.db, G, A);
    await insertMember(harness.db, G, B);
    await insertMember(harness.db, G, C);
    await insertExpense(harness.db, {
      id: EXPENSE_1,
      groupId: G,
      payerUserId: A,
      amount: 900,
      shares: [
        { userId: A, amount: 300 },
        { userId: B, amount: 300 },
        { userId: C, amount: 300 },
      ],
    });
    await insertSettlement(harness.db, { id: SETTLEMENT_1, groupId: G, fromUserId: B, toUserId: A, amount: 100 });
    // A USD expense settled in USD, so the settlement legs' `s.currency` is
    // exercised: with every settlement in TWD, hard-coding that column to
    // 'TWD' survived, and a USD repayment would have landed on the TWD line.
    await insertExpense(harness.db, {
      id: EXPENSE_3,
      groupId: G,
      payerUserId: C,
      currency: "USD",
      amount: 80,
      shares: [{ userId: B, amount: 80 }],
    });
    await insertSettlement(harness.db, { id: SETTLEMENT_3, groupId: G, fromUserId: B, toUserId: C, amount: 30, currency: "USD" });
    // A SECOND group with the same three members. The groupless noise below
    // only proves the scope predicate *exists*; it cannot prove it names
    // **this** group — widening `group_id = G` to `group_id IS NOT NULL`
    // stayed green without this. Two trips with the same friends would then
    // each show the sum of both.
    await insertGroup(harness.db, G2, "Other trip", A);
    await insertMember(harness.db, G2, A);
    await insertMember(harness.db, G2, B);
    await insertMember(harness.db, G2, C);
    await insertExpense(harness.db, {
      id: EXPENSE_4,
      groupId: G2,
      payerUserId: B,
      amount: 210,
      shares: [{ userId: C, amount: 210 }],
    });
    await insertSettlement(harness.db, { id: SETTLEMENT_4, groupId: G2, fromUserId: C, toUserId: B, amount: 70 });
    // Out-of-group noise among the same members — none of the group's business.
    await insertExpense(harness.db, { id: EXPENSE_2, payerUserId: A, amount: 60, shares: [{ userId: B, amount: 60 }] });
    await insertSettlement(harness.db, { id: SETTLEMENT_2, fromUserId: C, toUserId: A, amount: 40 });

    const balances = await repo.balancesForGroup(G);
    // Exactly one entry per member, named — same reason as 3.1.
    expect(balances.map((balance) => balance.displayName).sort()).toEqual(["Ann", "Ben", "Cid"]);
    // A's entry asserted whole, for the same reason 3.1 does it: mutating the
    // `JOIN users` correlation in *this* query returned each member three
    // times under a non-deterministic name, and every other check here
    // survived it — `amountAgainst` is a `.find` so it takes the first, the
    // displayName set is per-userId, and zero-sum stays 0 when it triples.
    expect(balances.find((balance) => balance.userId === A)).toEqual({
      userId: A,
      displayName: "Ann",
      // A is not in the USD expense (C paid, B owes), so exactly one line.
      balances: [{ currency: "TWD", amount: 500 }],
    });
    expect(amountAgainst(balances, A)).toBe(500);
    expect(amountAgainst(balances, B)).toBe(-200);
    expect(amountAgainst(balances, C)).toBe(-300);
    expect(amountAgainst(balances, C, "USD")).toBe(50);
    expect(amountAgainst(balances, B, "USD")).toBe(-50);
    // Extra check only — zero-sum holds under either sign convention, so it
    // is not evidence of direction.
    expect(balances.flatMap((balance) => balance.balances).reduce((sum, entry) => sum + entry.amount, 0)).toBe(0);
  });

  // 3.4 — the payer's own share never becomes "owing themselves".
  it("excludes the payer's own share from their personal balances", async () => {
    await insertExpense(harness.db, {
      id: EXPENSE_1,
      payerUserId: A,
      amount: 300,
      shares: [
        { userId: A, amount: 150 },
        { userId: B, amount: 150 },
      ],
    });

    const balances = await repo.balancesForUser(A);
    expect(balances.map((balance) => balance.userId)).toEqual([B]);
    expect(amountAgainst(balances, B)).toBe(150);
  });

  // 3.5 — currencies are never combined, and settling one leaves the other.
  it("keeps currencies separate and settles them independently", async () => {
    await insertExpense(harness.db, { id: EXPENSE_1, payerUserId: A, amount: 300, currency: "TWD", shares: [{ userId: B, amount: 300 }] });
    await insertExpense(harness.db, { id: EXPENSE_2, payerUserId: A, amount: 50, currency: "USD", shares: [{ userId: B, amount: 50 }] });

    const before = await repo.balancesForUser(A);
    expect(amountAgainst(before, B, "TWD")).toBe(300);
    expect(amountAgainst(before, B, "USD")).toBe(50);

    // Settle the **USD** side, not the TWD one. With every settlement in the
    // file denominated in TWD, replacing `s.currency` with a literal 'TWD' on
    // any settlement leg survived — a repayment of a USD debt would have
    // landed on the TWD balance, leaving the USD debt uncleared and silently
    // shrinking the TWD figure. Both sides are asserted because asserting only
    // A's leaves the `from_user_id = me` leg unexercised.
    await insertSettlement(harness.db, { id: SETTLEMENT_1, fromUserId: B, toUserId: A, amount: 50, currency: "USD" });

    const after = await repo.balancesForUser(A);
    expect(amountAgainst(after, B, "USD")).toBeUndefined();
    expect(amountAgainst(after, B, "TWD")).toBe(300);

    const fromB = await repo.balancesForUser(B);
    expect(amountAgainst(fromB, A, "USD")).toBeUndefined();
    expect(amountAgainst(fromB, A, "TWD")).toBe(-300);
  });
});
