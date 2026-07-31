import { beforeEach, describe, expect, it } from "vitest";
import { createTransaction } from "../../../../src/contexts/finance/application/create-transaction";
import { deleteBudget } from "../../../../src/contexts/finance/application/delete-budget";
import { listBudgetsWithProgress } from "../../../../src/contexts/finance/application/list-budgets-with-progress";
import { upsertBudget } from "../../../../src/contexts/finance/application/upsert-budget";
import {
  FinanceBudgetNotFound,
  FinanceCategoryArchived,
  FinanceCategoryNotFound,
  FinanceCategoryTypeMismatch,
  InvalidFinanceInputError,
} from "../../../../src/contexts/finance/domain/errors";
import { InMemoryFinanceBudgetRepository, InMemoryFinanceCategoryRepository, InMemoryFinanceTransactionRepository } from "../fakes";

let categories: InMemoryFinanceCategoryRepository;
let transactions: InMemoryFinanceTransactionRepository;
let budgets: InMemoryFinanceBudgetRepository;

beforeEach(() => {
  categories = new InMemoryFinanceCategoryRepository();
  transactions = new InMemoryFinanceTransactionRepository();
  budgets = new InMemoryFinanceBudgetRepository(transactions);
});

async function seedCategory(overrides: Partial<{ userId: string; type: "expense" | "income"; name: string }> = {}) {
  return categories.create({
    userId: overrides.userId ?? "user-1",
    name: overrides.name ?? "餐飲",
    type: overrides.type ?? "expense",
  });
}

describe("upsertBudget", () => {
  it("creates an overall budget (category_id null)", async () => {
    const budget = await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 20000 });
    expect(budget).toMatchObject({ userId: "user-1", categoryId: null, amount: 20000 });
    expect(budgets.budgets).toHaveLength(1);
  });

  it("upserts: a second PUT for the same scope updates the amount instead of creating a second row", async () => {
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 20000 });
    const updated = await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 25000 });
    expect(updated.amount).toBe(25000);
    expect(budgets.budgets).toHaveLength(1);
  });

  it("creates a category budget for an existing, owned, expense, unarchived category", async () => {
    const category = await seedCategory();
    const budget = await upsertBudget(categories, budgets, { userId: "user-1", categoryId: category.id, amount: 3000 });
    expect(budget).toMatchObject({ categoryId: category.id, amount: 3000 });
  });

  it("rejects amount <= 0", async () => {
    await expect(upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 0 })).rejects.toBeInstanceOf(InvalidFinanceInputError);
    await expect(upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: -5 })).rejects.toBeInstanceOf(InvalidFinanceInputError);
    expect(budgets.budgets).toHaveLength(0);
  });

  it("rejects a non-integer amount", async () => {
    await expect(upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 12.5 })).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });

  it("rejects a missing/unknown category_id as FinanceCategoryNotFound (404)", async () => {
    await expect(upsertBudget(categories, budgets, { userId: "user-1", categoryId: "nope", amount: 1000 })).rejects.toBeInstanceOf(FinanceCategoryNotFound);
  });

  it("rejects another user's category_id as FinanceCategoryNotFound (404)", async () => {
    const category = await seedCategory({ userId: "user-2" });
    await expect(upsertBudget(categories, budgets, { userId: "user-1", categoryId: category.id, amount: 1000 })).rejects.toBeInstanceOf(FinanceCategoryNotFound);
  });

  it("rejects an income category as a type mismatch (400)", async () => {
    const income = await seedCategory({ type: "income", name: "薪資" });
    await expect(upsertBudget(categories, budgets, { userId: "user-1", categoryId: income.id, amount: 1000 })).rejects.toBeInstanceOf(FinanceCategoryTypeMismatch);
  });

  it("rejects an archived category (400)", async () => {
    const category = await seedCategory();
    await categories.update("user-1", category.id, { archived: true });
    await expect(upsertBudget(categories, budgets, { userId: "user-1", categoryId: category.id, amount: 1000 })).rejects.toBeInstanceOf(FinanceCategoryArchived);
    expect(budgets.budgets).toHaveLength(0);
  });

  it("keeps different users' overall budgets isolated", async () => {
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 20000 });
    await upsertBudget(categories, budgets, { userId: "user-2", categoryId: null, amount: 5000 });
    expect(budgets.budgets).toHaveLength(2);
  });
});

describe("deleteBudget", () => {
  it("deletes an owned budget", async () => {
    const budget = await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 20000 });
    await deleteBudget(budgets, "user-1", budget.id);
    expect(budgets.budgets).toHaveLength(0);
  });

  it("throws FinanceBudgetNotFound for another user's budget, leaving it intact", async () => {
    const budget = await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 20000 });
    await expect(deleteBudget(budgets, "user-2", budget.id)).rejects.toBeInstanceOf(FinanceBudgetNotFound);
    expect(budgets.budgets).toHaveLength(1);
  });

  it("throws FinanceBudgetNotFound for an unknown id", async () => {
    await expect(deleteBudget(budgets, "user-1", "nope")).rejects.toBeInstanceOf(FinanceBudgetNotFound);
  });

  it("cascades to its alert records", async () => {
    const budget = await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 100 });
    await budgets.tryRecordAlert({ userId: "user-1", budgetId: budget.id, month: "2026-07", threshold: 80 });
    await deleteBudget(budgets, "user-1", budget.id);
    expect(budgets.alerts).toHaveLength(0);
  });
});

describe("listBudgetsWithProgress", () => {
  it("splits overall and category scopes correctly, excluding foreign currency", async () => {
    const food = await seedCategory({ name: "餐飲" });
    const transit = await seedCategory({ name: "交通" });
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 10000 });
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 3000 });

    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 2500, currency: "TWD", categoryId: food.id, date: "2026-07-10" });
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 1000, currency: "TWD", categoryId: transit.id, date: "2026-07-11" });
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 999, currency: "USD", categoryId: food.id, date: "2026-07-12" });

    const progress = await listBudgetsWithProgress(budgets, "user-1", "2026-07");
    expect(progress).toHaveLength(2);

    const overall = progress.find((p) => p.categoryId === null);
    expect(overall).toMatchObject({ amount: 10000, spent: 3500, remaining: 6500 });

    const foodProgress = progress.find((p) => p.categoryId === food.id);
    expect(foodProgress).toMatchObject({ amount: 3000, spent: 2500, remaining: 500 });
  });

  it("reports a negative remaining when spending exceeds the budget", async () => {
    const food = await seedCategory({ name: "餐飲" });
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 1200, currency: "TWD", categoryId: food.id, date: "2026-07-01" });

    const progress = await listBudgetsWithProgress(budgets, "user-1", "2026-07");
    expect(progress[0]).toMatchObject({ amount: 1000, spent: 1200, remaining: -200 });
  });

  it("rejects a malformed month", async () => {
    await expect(listBudgetsWithProgress(budgets, "user-1", "not-a-month")).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });

  it("returns an empty list when the user has no budgets", async () => {
    const progress = await listBudgetsWithProgress(budgets, "user-1", "2026-07");
    expect(progress).toEqual([]);
  });
});
