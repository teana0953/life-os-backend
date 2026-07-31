import { beforeEach, describe, expect, it } from "vitest";
import { createTransaction } from "../../../../src/contexts/finance/application/create-transaction";
import { getMonthlySummary } from "../../../../src/contexts/finance/application/get-monthly-summary";
import { InMemoryFinanceCategoryRepository, InMemoryFinanceTransactionRepository } from "../fakes";

let categories: InMemoryFinanceCategoryRepository;
let transactions: InMemoryFinanceTransactionRepository;

beforeEach(() => {
  categories = new InMemoryFinanceCategoryRepository();
  transactions = new InMemoryFinanceTransactionRepository();
});

describe("getMonthlySummary", () => {
  it("splits totals per currency and computes expense/income/net", async () => {
    const food = await categories.create({ userId: "user-1", name: "餐飲", type: "expense" });
    const salary = await categories.create({ userId: "user-1", name: "薪資", type: "income" });

    await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 300,
      currency: "TWD",
      categoryId: food.id,
      date: "2026-07-05",
    });
    await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 1000,
      currency: "USD",
      categoryId: food.id,
      date: "2026-07-06",
    });
    await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "income",
      amount: 50000,
      currency: "TWD",
      categoryId: salary.id,
      date: "2026-07-01",
    });

    const summary = await getMonthlySummary(transactions, "user-1", "2026-07");

    expect(summary.month).toBe("2026-07");
    expect(summary.totals).toHaveLength(2);
    expect(summary.totals).toEqual(
      expect.arrayContaining([
        { currency: "TWD", expense: 300, income: 50000, net: 49700 },
        { currency: "USD", expense: 1000, income: 0, net: -1000 },
      ]),
    );
    expect(summary.byCategory).toEqual(
      expect.arrayContaining([
        { categoryId: food.id, type: "expense", currency: "TWD", amount: 300 },
        { categoryId: food.id, type: "expense", currency: "USD", amount: 1000 },
        { categoryId: salary.id, type: "income", currency: "TWD", amount: 50000 },
      ]),
    );
  });

  it("returns empty totals and by_category for a month with no transactions", async () => {
    const summary = await getMonthlySummary(transactions, "user-1", "2026-09");
    expect(summary).toEqual({ month: "2026-09", totals: [], byCategory: [] });
  });

  it("excludes other users and other months", async () => {
    const category = await categories.create({ userId: "user-1", name: "餐飲", type: "expense" });
    await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 300,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-05",
    });

    const otherUserSummary = await getMonthlySummary(transactions, "user-2", "2026-07");
    expect(otherUserSummary).toEqual({ month: "2026-07", totals: [], byCategory: [] });

    const otherMonthSummary = await getMonthlySummary(transactions, "user-1", "2026-08");
    expect(otherMonthSummary).toEqual({ month: "2026-08", totals: [], byCategory: [] });
  });
});
