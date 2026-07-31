import { beforeEach, describe, expect, it } from "vitest";
import { checkBudgetAlerts } from "../../../../src/contexts/finance/application/check-budget-alerts";
import { upsertBudget } from "../../../../src/contexts/finance/application/upsert-budget";
import { createTransaction } from "../../../../src/contexts/finance/application/create-transaction";
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

async function seedFoodCategory(userId = "user-1") {
  return categories.create({ userId, name: "餐飲", type: "expense" });
}

async function spendAndCheck(userId: string, categoryId: string, amount: number, date: string) {
  const txn = await createTransaction(categories, transactions, { userId, type: "expense", amount, currency: "TWD", categoryId, date });
  await checkBudgetAlerts(
    { budgetRepository: budgets, categoryRepository: categories, notifier },
    { userId, type: "expense", currency: "TWD", categoryId, date },
  );
  return txn;
}

describe("checkBudgetAlerts", () => {
  it("crossing 80% notifies exactly once, and a later non-crossing write sends nothing more", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });

    await spendAndCheck("user-1", food.id, 700, "2026-07-01");
    expect(notifier.messages).toHaveLength(0);

    await spendAndCheck("user-1", food.id, 150, "2026-07-02"); // 850/1000 = 85% >= 80%
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toMatchObject({ userId: "user-1", message: { title: "預算提醒", body: "7月餐飲支出已達預算 8 成" } });

    await spendAndCheck("user-1", food.id, 50, "2026-07-03"); // still under 100%, 80% already recorded
    expect(notifier.messages).toHaveLength(1);
  });

  it("one write can cross both 80 and 100 in a single check, sending two pushes", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });

    await spendAndCheck("user-1", food.id, 1200, "2026-07-01");

    expect(notifier.messages).toHaveLength(2);
    expect(notifier.messages.map((m) => m.message.title).sort()).toEqual(["預算提醒", "預算超支"].sort());
    const overSpend = notifier.messages.find((m) => m.message.title === "預算超支");
    expect(overSpend?.message.body).toBe("7月餐飲支出已超過預算");
  });

  it("checks the overall budget too, with distinct copy from the category budget", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 1000 });

    await spendAndCheck("user-1", food.id, 900, "2026-07-01");

    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0].message).toEqual({ title: "預算提醒", body: "7月支出已達預算 8 成" });
  });

  it("backdated transactions check their own month, not the current one", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });

    // Recorded "in August" but dated in July.
    await spendAndCheck("user-1", food.id, 900, "2026-07-20");

    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0].message.body).toContain("7月");
    expect(budgets.alerts[0]).toMatchObject({ month: "2026-07", threshold: 80 });
  });

  it("does not fire for a non-TWD expense", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 5000, currency: "USD", categoryId: food.id, date: "2026-07-01" });

    await checkBudgetAlerts(
      { budgetRepository: budgets, categoryRepository: categories, notifier },
      { userId: "user-1", type: "expense", currency: "USD", categoryId: food.id, date: "2026-07-01" },
    );
    expect(notifier.messages).toHaveLength(0);
  });

  it("does not fire for a TWD income transaction, however large", async () => {
    const salary = await categories.create({ userId: "user-1", name: "薪資", type: "income" });
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: null, amount: 1000 });

    await checkBudgetAlerts(
      { budgetRepository: budgets, categoryRepository: categories, notifier },
      { userId: "user-1", type: "income", currency: "TWD", categoryId: salary.id, date: "2026-07-01" },
    );
    expect(notifier.messages).toHaveLength(0);
  });

  it("does not throw when the notifier's push delivery fails, and still records the alert", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    const failingNotifier = new FakeBudgetAlertNotifier(() => {
      throw new Error("push delivery failed");
    });

    const txn = await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 900, currency: "TWD", categoryId: food.id, date: "2026-07-01" });
    await expect(
      checkBudgetAlerts(
        { budgetRepository: budgets, categoryRepository: categories, notifier: failingNotifier },
        { userId: "user-1", type: "expense", currency: "TWD", categoryId: food.id, date: "2026-07-01" },
      ),
    ).resolves.toBeUndefined();
    expect(txn.amount).toBe(900);
    expect(budgets.alerts).toHaveLength(1); // the dedup record was still written before notify was attempted
  });

  it("dedups under a simulated concurrent write: the second tryRecordAlert loses and no second push is sent", async () => {
    const food = await seedFoodCategory();
    const budget = await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    // Simulate another concurrent request already having recorded the alert.
    await budgets.tryRecordAlert({ userId: "user-1", budgetId: budget.id, month: "2026-07", threshold: 80 });

    await spendAndCheck("user-1", food.id, 900, "2026-07-01");

    expect(notifier.messages).toHaveLength(0); // this write's tryRecordAlert lost the race
  });

  it("on update with a category change, checks both the old and new category budgets", async () => {
    const food = await seedFoodCategory();
    const transit = await categories.create({ userId: "user-1", name: "交通", type: "expense" });
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: transit.id, amount: 500 });

    // Pre-existing spend on food already at 80%+, and on transit already at 80%+, before this update.
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 900, currency: "TWD", categoryId: food.id, date: "2026-07-01" });
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 450, currency: "TWD", categoryId: transit.id, date: "2026-07-02" });

    await checkBudgetAlerts(
      { budgetRepository: budgets, categoryRepository: categories, notifier },
      { userId: "user-1", type: "expense", currency: "TWD", categoryId: transit.id, previousCategoryId: food.id, date: "2026-07-02" },
    );

    expect(notifier.messages).toHaveLength(2);
    const bodies = notifier.messages.map((m) => m.message.body).sort();
    expect(bodies).toEqual(["7月交通支出已達預算 8 成", "7月餐飲支出已達預算 8 成"].sort());
  });

  it("does not double-check the category budget when the category is unchanged on update", async () => {
    const food = await seedFoodCategory();
    await upsertBudget(categories, budgets, { userId: "user-1", categoryId: food.id, amount: 1000 });
    await createTransaction(categories, transactions, { userId: "user-1", type: "expense", amount: 900, currency: "TWD", categoryId: food.id, date: "2026-07-01" });

    await checkBudgetAlerts(
      { budgetRepository: budgets, categoryRepository: categories, notifier },
      { userId: "user-1", type: "expense", currency: "TWD", categoryId: food.id, previousCategoryId: food.id, date: "2026-07-01" },
    );

    expect(notifier.messages).toHaveLength(1);
  });
});
