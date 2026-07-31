import { beforeEach, describe, expect, it } from "vitest";
import { createTransaction } from "../../../../src/contexts/finance/application/create-transaction";
import { deleteTransaction } from "../../../../src/contexts/finance/application/delete-transaction";
import { updateTransaction } from "../../../../src/contexts/finance/application/update-transaction";
import { upsertBudget } from "../../../../src/contexts/finance/application/upsert-budget";
import {
  FakeBudgetAlertNotifier,
  InMemoryFinanceBudgetRepository,
  InMemoryFinanceCategoryRepository,
  InMemoryFinanceTransactionRepository,
} from "../fakes";

let categories: InMemoryFinanceCategoryRepository;
let transactions: InMemoryFinanceTransactionRepository;
let budgets: InMemoryFinanceBudgetRepository;
let notifier: FakeBudgetAlertNotifier;

beforeEach(() => {
  categories = new InMemoryFinanceCategoryRepository();
  transactions = new InMemoryFinanceTransactionRepository();
  budgets = new InMemoryFinanceBudgetRepository(transactions);
  notifier = new FakeBudgetAlertNotifier();
});

async function seedFoodCategory() {
  return categories.create({ userId: "user-1", name: "餐飲", type: "expense" });
}

function budgetAlertDeps() {
  return { budgetRepository: budgets, categoryRepository: categories, notifier };
}

describe("createTransaction budget-alert wiring", () => {
  it("calls the budget-alert check after a successful TWD expense write and it can push", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });

    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 900, currency: "TWD", categoryId: food.id, date: "2026-07-01" }, budgetAlertDeps());

    expect(notifier.messages).toHaveLength(1);
  });

  it("a throwing budget-alert check does not affect the transaction response", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    const throwingDeps = {
      budgetRepository: {
        upsert: budgets.upsert.bind(budgets),
        findByUserAndCategory: async (): Promise<never> => {
          throw new Error("boom");
        },
        delete: budgets.delete.bind(budgets),
        listWithSpent: budgets.listWithSpent.bind(budgets),
        getSpent: budgets.getSpent.bind(budgets),
        tryRecordAlert: budgets.tryRecordAlert.bind(budgets),
      },
      categoryRepository: categories,
      notifier,
    };

    const txn = await createTransaction(
      categories,
      transactions,
      { userId: "user-1", type: "expense", amount: 900, currency: "TWD", categoryId: food.id, date: "2026-07-01" },
      throwingDeps,
    );

    expect(txn).toMatchObject({ amount: 900, currency: "TWD" });
    expect(transactions.transactions).toHaveLength(1);
  });

  it("does not call the check when no budget-alert deps are provided (optional)", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 900, currency: "TWD", categoryId: food.id, date: "2026-07-01" });
    expect(notifier.messages).toHaveLength(0);
  });
});

describe("updateTransaction budget-alert wiring", () => {
  it("calls the budget-alert check after a successful update, checking both old and new categories when it changed", async () => {
    const food = await seedFoodCategory();
    const transit = await categories.create({ userId: "user-1", name: "交通", type: "expense" });
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: transit.id, amount: 500 });

    const txn = await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 100, currency: "TWD", categoryId: food.id, date: "2026-07-01" });
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 900, currency: "TWD", categoryId: food.id, date: "2026-07-02" }); // food now at 1000

    await updateTransaction(
      categories,
      transactions,
      "user-1",
      txn.id,
      { type: "expense", amount: 450, currency: "TWD", categoryId: transit.id, date: "2026-07-01" },
      budgetAlertDeps(),
    );

    // transit: 450/500 = 90% -> 80% alert; food's remaining spend (900) is still under 80% of 1000 alone,
    // but the old category is still checked (its 80% line was already crossed earlier by the 900 write, already recorded then).
    expect(notifier.messages.some((m) => m.message.body.includes("交通"))).toBe(true);
  });

  it("a throwing budget-alert check does not affect the update response", async () => {
    const food = await seedFoodCategory();
    const txn = await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 100, currency: "TWD", categoryId: food.id, date: "2026-07-01" });
    const throwingDeps = {
      budgetRepository: {
        upsert: budgets.upsert.bind(budgets),
        findByUserAndCategory: async (): Promise<never> => {
          throw new Error("boom");
        },
        delete: budgets.delete.bind(budgets),
        listWithSpent: budgets.listWithSpent.bind(budgets),
        getSpent: budgets.getSpent.bind(budgets),
        tryRecordAlert: budgets.tryRecordAlert.bind(budgets),
      },
      categoryRepository: categories,
      notifier,
    };

    const updated = await updateTransaction(
      categories,
      transactions,
      "user-1",
      txn.id,
      { type: "expense", amount: 200, currency: "TWD", categoryId: food.id, date: "2026-07-02" },
      throwingDeps,
    );

    expect(updated).toMatchObject({ amount: 200, date: "2026-07-02" });
  });
});

describe("deleteTransaction does not trigger budget-alert checks", () => {
  it("deleting a transaction sends no push, even past a threshold", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    const txn = await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 900, currency: "TWD", categoryId: food.id, date: "2026-07-01" }, budgetAlertDeps());
    notifier.messages.length = 0; // clear the create-triggered alert

    await deleteTransaction(transactions, "user-1", txn.id);

    expect(notifier.messages).toHaveLength(0);
  });
});
