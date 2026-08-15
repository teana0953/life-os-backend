import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleExpenseGroupRepository } from "../../src/contexts/split/adapters/drizzle-expense-group-repository";
import { DrizzleSplitExpenseRepository } from "../../src/contexts/split/adapters/drizzle-split-expense-repository";
import { createTestDb, insertExpense, insertGroup, insertMember, insertUser, type TestDb } from "./harness";

/**
 * `splitSpendingForUser` and `shareAnyGroup` against a real Postgres.
 *
 * Deliberately NOT tested here: "a settlement is not counted as split
 * spending". `splitSpendingForUser` never reads `split_settlement` at all, so
 * that holds by construction and no mutation of this query could make such a
 * test fail — exactly the kind of test this change exists to eliminate. The
 * reason it needs no exclusion is already written where the code is, in
 * `drizzle-split-expense-repository.ts`.
 */
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";
const G = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const H = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EXPENSE_1 = "e1111111-1111-1111-1111-111111111111";
const EXPENSE_2 = "e2222222-2222-2222-2222-222222222222";
const EXPENSE_3 = "e3333333-3333-3333-3333-333333333333";
const EXPENSE_4 = "e4444444-4444-4444-4444-444444444444";

describe("splitSpendingForUser (real Postgres)", () => {
  let harness: TestDb;
  let repo: DrizzleSplitExpenseRepository;

  beforeAll(async () => {
    harness = await createTestDb();
    repo = new DrizzleSplitExpenseRepository(() => harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * E1 payer A, 300 TWD, shares A 100 / B 200  <- A's own share on their own expense
   * E2 payer B, 500 TWD, shares A 150 / B 350
   * E3 payer A,  50 USD, shares A  50          <- second currency, own share only
   * E4 payer A, 999 TWD, shares A 999, day 2026-04-05  <- a different month
   */
  beforeEach(async () => {
    await harness.resetDb();
    const db = harness.db;
    await insertUser(db, A, "a@example.com", "Ann");
    await insertUser(db, B, "b@example.com", "Ben");
    await insertExpense(db, {
      id: EXPENSE_1,
      payerUserId: A,
      amount: 300,
      shares: [
        { userId: A, amount: 100 },
        { userId: B, amount: 200 },
      ],
    });
    await insertExpense(db, {
      id: EXPENSE_2,
      payerUserId: B,
      amount: 500,
      shares: [
        { userId: A, amount: 150 },
        { userId: B, amount: 350 },
      ],
    });
    await insertExpense(db, { id: EXPENSE_3, payerUserId: A, amount: 50, currency: "USD", shares: [{ userId: A, amount: 50 }] });
    await insertExpense(db, { id: EXPENSE_4, payerUserId: A, amount: 999, day: "2026-04-05", shares: [{ userId: A, amount: 999 }] });
  });

  const spending = async (userId: string, month: string) => {
    const rows = await repo.splitSpendingForUser(userId, month);
    return Object.fromEntries(rows.map((row) => [row.currency, row.amount]));
  };

  // 4.1 — the payer's own share IS counted (they really spent it), which is
  // the opposite of the balance query's rule; and currencies stay separate.
  it("sums the caller's own share per currency, including on expenses they paid themselves", async () => {
    expect(await spending(A, "2026-03")).toEqual({ TWD: 250, USD: 50 });
  });

  it("counts only the requested month and returns nothing for an empty one", async () => {
    expect(await spending(A, "2026-04")).toEqual({ TWD: 999 });
    expect(await repo.splitSpendingForUser(A, "2026-05")).toEqual([]);
  });
});

describe("DrizzleExpenseGroupRepository.shareAnyGroup (real Postgres)", () => {
  let harness: TestDb;
  let repo: DrizzleExpenseGroupRepository;

  beforeAll(async () => {
    harness = await createTestDb();
    repo = new DrizzleExpenseGroupRepository(() => harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  // A and B share group G; C is in G too; D is only in H, which nobody else
  // is in — so D has membership rows but no group in common with A.
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
    await insertGroup(db, H, "Solo", D);
    await insertMember(db, H, D);
  });

  it("is true for a pair in the same group", async () => {
    expect(await repo.shareAnyGroup(A, B)).toBe(true);
  });

  it("is false for a pair with no group in common", async () => {
    expect(await repo.shareAnyGroup(A, D)).toBe(false);
  });
});
