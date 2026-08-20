import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { financeTransaction } from "../../src/shared/db/schema";
import { DrizzleFinanceBudgetRepository } from "../../src/contexts/finance/adapters/drizzle-finance-budget-repository";
import { createTestDb, insertCategory, insertUser, type TestDb } from "./harness";

const U = "11111111-1111-1111-1111-111111111111";
const OTHER = "11111111-1111-1111-1111-111111111112";
const FOOD = "cccccccc-cccc-cccc-cccc-cccccccccc01";
const TRANSPORT = "cccccccc-cccc-cccc-cccc-cccccccccc02";

/**
 * `listWithSpent` used to sum each budget's spend with a separate query per
 * row (an N+1 the batch-screen-reads review caught: it is invisible to a
 * test/fake that stubs a single budget, but unbounded query count is exactly
 * what threatens the Workers subrequest cap the batch endpoints share across
 * their whole section fan-out). This pins the single-query replacement
 * against real SQL: an overall budget (`categoryId: null`) must sum every
 * category's spend, a category budget only its own, and a query with zero
 * matching transactions must not disappear via an inner join.
 */
describe("DrizzleFinanceBudgetRepository.listWithSpent (SQL aggregation)", () => {
  let harness: TestDb;

  beforeAll(async () => {
    harness = await createTestDb();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    await insertUser(harness.db, U, "u@example.com", "Uma");
    await insertUser(harness.db, OTHER, "other@example.com", "Otto");
    await insertCategory(harness.db, { id: FOOD, userId: U, name: "食物" });
    await insertCategory(harness.db, { id: TRANSPORT, userId: U, name: "交通" });
  });

  it("sums the overall budget across every category and a category budget within only its own", async () => {
    const repo = new DrizzleFinanceBudgetRepository(() => harness.db);
    await repo.upsert({ userId: U, categoryId: null, amount: 30_000 });
    await repo.upsert({ userId: U, categoryId: FOOD, amount: 5_000 });

    await harness.db.insert(financeTransaction).values([
      { userId: U, type: "expense", amount: 1_000, currency: "TWD", categoryId: FOOD, day: "2026-08-01" },
      { userId: U, type: "expense", amount: 2_000, currency: "TWD", categoryId: TRANSPORT, day: "2026-08-02" },
      // Outside the queried month — must not be counted.
      { userId: U, type: "expense", amount: 9_000, currency: "TWD", categoryId: FOOD, day: "2026-07-15" },
      // Income, not expense — must not be counted.
      { userId: U, type: "income", amount: 4_000, currency: "TWD", categoryId: FOOD, day: "2026-08-03" },
      // Another user's expense, deliberately in the *same* month and the same
      // category row: without the join's `ft.user_id = fb.user_id`, this is
      // summed into Uma's food and overall budgets — cross-user money
      // corruption that no other assertion here can see.
      { userId: OTHER, type: "expense", amount: 7_000, currency: "TWD", categoryId: FOOD, day: "2026-08-04" },
      // Uma's own expense in a non-TWD currency, same month and category:
      // budgets are TWD-only, so without the join's `currency = 'TWD'` this
      // amount is added to a TWD total as if the two were interchangeable.
      { userId: U, type: "expense", amount: 500_000, currency: "JPY", categoryId: FOOD, day: "2026-08-05" },
    ]);

    const rows = await repo.listWithSpent(U, "2026-08");

    const foodBudget = rows.find((r) => r.budget.categoryId === FOOD);
    expect(foodBudget?.spent).toBe(1_000);
    const overallBudget = rows.find((r) => r.budget.categoryId === null);
    expect(overallBudget?.spent).toBe(3_000); // 1,000 (food) + 2,000 (transport)
  });

  it("returns 0, not a dropped row, for a budget with no matching transactions", async () => {
    const repo = new DrizzleFinanceBudgetRepository(() => harness.db);
    await repo.upsert({ userId: U, categoryId: TRANSPORT, amount: 2_000 });

    const rows = await repo.listWithSpent(U, "2026-08");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.spent).toBe(0);
  });

  it("issues exactly one query regardless of budget count", async () => {
    const queries: string[] = [];
    const counted = await createTestDb({ onQuery: (sql) => queries.push(sql) });
    try {
      await insertUser(counted.db, U, "u@example.com", "Uma");
      await insertCategory(counted.db, { id: FOOD, userId: U, name: "食物" });
      await insertCategory(counted.db, { id: TRANSPORT, userId: U, name: "交通" });
      const repo = new DrizzleFinanceBudgetRepository(() => counted.db);
      await repo.upsert({ userId: U, categoryId: null, amount: 30_000 });
      await repo.upsert({ userId: U, categoryId: FOOD, amount: 5_000 });
      await repo.upsert({ userId: U, categoryId: TRANSPORT, amount: 1_000 });

      queries.length = 0;
      await repo.listWithSpent(U, "2026-08");

      expect(queries.filter((q) => /^select/i.test(q.trim()))).toHaveLength(1);
    } finally {
      await counted.close();
    }
  });
});
