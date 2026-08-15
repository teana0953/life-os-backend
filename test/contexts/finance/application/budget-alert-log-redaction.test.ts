import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstallmentPlan, type InstallmentDeps } from "../../../../src/contexts/finance/application/create-installment-plan";
import { createTransaction } from "../../../../src/contexts/finance/application/create-transaction";
import { updateTransaction } from "../../../../src/contexts/finance/application/update-transaction";
import { settleInstallmentPlan } from "../../../../src/contexts/finance/application/settle-installment-plan";
import { updateInstallmentPlan } from "../../../../src/contexts/finance/application/update-installment-plan";
import { checkBudgetAlerts } from "../../../../src/contexts/finance/application/check-budget-alerts";
import {
  FakeBudgetAlertNotifier,
  InMemoryFinanceBudgetRepository,
  InMemoryFinanceCategoryRepository,
  InMemoryFinanceTransactionRepository,
} from "../fakes";
import { InMemoryInstallmentPlanRepository } from "../installment-fakes";
import {
  DIAGNOSTIC_PG_CODE,
  SECRET_PARAM_VALUE,
  SECRET_ROW_VALUE,
  drizzleQueryErrorWithPgCause,
} from "../../../helpers/drizzle-error";
import { loggedTextFrom } from "../../../helpers/logged-text";

/**
 * Every best-effort `catch` in the finance use cases logs a DB error that
 * carries row data (bound query parameters, a pg row value echoed into the
 * message). Logging the raw error puts that data in Workers Logs, where it is
 * retained and readable by anyone with dashboard access.
 *
 * Each case asserts BOTH halves of the boundary: the secret is gone AND the
 * diagnostic (`22P02`, the layered chain) survives. Without the second half a
 * blanket `console.error("failed")` would pass, and the next incident becomes
 * "something failed, no idea what".
 */

const USER = "user-1";

let categories: InMemoryFinanceCategoryRepository;
let transactions: InMemoryFinanceTransactionRepository;
let budgets: InMemoryFinanceBudgetRepository;
let plans: InMemoryInstallmentPlanRepository;
let notifier: FakeBudgetAlertNotifier;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  categories = new InMemoryFinanceCategoryRepository();
  transactions = new InMemoryFinanceTransactionRepository();
  budgets = new InMemoryFinanceBudgetRepository(transactions);
  plans = new InMemoryInstallmentPlanRepository(transactions);
  notifier = new FakeBudgetAlertNotifier();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function loggedText(): string {
  return loggedTextFrom(errorSpy);
}

function expectRedactedButDiagnostic(): void {
  const text = loggedText();
  expect(text).not.toBe("");
  expect(text).not.toContain(SECRET_PARAM_VALUE);
  expect(text).not.toContain(SECRET_ROW_VALUE);
  expect(text).toContain(DIAGNOSTIC_PG_CODE);
  expect(text).toContain("invalid input syntax for type uuid");
}

/** Fails the way the real repository fails: a DrizzleQueryError from the first budget lookup. */
function throwingBudgetAlertDeps() {
  return {
    budgetRepository: {
      upsert: budgets.upsert.bind(budgets),
      findByUserAndCategory: async (): Promise<never> => {
        throw drizzleQueryErrorWithPgCause();
      },
      delete: budgets.delete.bind(budgets),
      listWithSpent: budgets.listWithSpent.bind(budgets),
      getSpent: budgets.getSpent.bind(budgets),
      tryRecordAlert: budgets.tryRecordAlert.bind(budgets),
    },
    categoryRepository: categories,
    notifier,
  };
}

const nowIso = "2026-04-20T02:00:00.000Z"; // 10:00 Asia/Taipei — same date in both zones

function installmentDeps(): InstallmentDeps {
  return {
    planRepository: plans,
    categoryRepository: categories,
    now: () => new Date(nowIso),
    getUserTimezone: async () => "Asia/Taipei",
  };
}

async function seedCategory() {
  return categories.create({ userId: USER, name: "餐飲", type: "expense" });
}

describe("finance use cases redact the DB error they log best-effort", () => {
  it("createTransaction", async () => {
    const category = await seedCategory();

    await createTransaction(
      categories,
      transactions,
      { userId: USER, type: "expense", amount: 900, currency: "TWD", categoryId: category.id, date: "2026-04-01" },
      throwingBudgetAlertDeps(),
    );

    expectRedactedButDiagnostic();
  });

  it("updateTransaction", async () => {
    const category = await seedCategory();
    const txn = await createTransaction(categories, transactions, {
      userId: USER,
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-04-01",
    });
    errorSpy.mockClear();

    await updateTransaction(
      categories,
      transactions,
      USER,
      txn.id,
      { type: "expense", amount: 200, currency: "TWD", categoryId: category.id, date: "2026-04-02" },
      throwingBudgetAlertDeps(),
    );

    expectRedactedButDiagnostic();
  });

  it("settleInstallmentPlan", async () => {
    const category = await seedCategory();
    const plan = await createInstallmentPlan(installmentDeps(), {
      userId: USER,
      mode: "per_installment",
      amount: 1000,
      periods: 12,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-01-15",
    });
    errorSpy.mockClear();

    await settleInstallmentPlan(installmentDeps(), { userId: USER, planId: plan.id, amount: 5000 }, throwingBudgetAlertDeps());

    expectRedactedButDiagnostic();
  });

  it("updateInstallmentPlan", async () => {
    const category = await seedCategory();
    const plan = await createInstallmentPlan(installmentDeps(), {
      userId: USER,
      mode: "per_installment",
      amount: 1000,
      periods: 12,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-01-15",
    });
    errorSpy.mockClear();

    await updateInstallmentPlan(installmentDeps(), { userId: USER, planId: plan.id, amount: 2000, periods: 12 }, throwingBudgetAlertDeps());

    expectRedactedButDiagnostic();
  });

  it("checkBudgetAlerts, when the push itself fails", async () => {
    const category = await seedCategory();
    await budgets.upsert({ userId: USER, categoryId: null, amount: 1000 });
    await createTransaction(categories, transactions, {
      userId: USER,
      type: "expense",
      amount: 900, // 90% of the overall budget — crosses the 80% threshold on its own
      currency: "TWD",
      categoryId: category.id,
      date: "2026-04-01",
    });
    const failingNotifier = new FakeBudgetAlertNotifier(() => {
      throw drizzleQueryErrorWithPgCause();
    });
    errorSpy.mockClear();

    await checkBudgetAlerts(
      { budgetRepository: budgets, categoryRepository: categories, notifier: failingNotifier },
      { userId: USER, type: "expense", currency: "TWD", categoryId: category.id, date: "2026-04-01" },
    );

    expect(failingNotifier.messages).toHaveLength(1); // the fixture really did reach the push
    expectRedactedButDiagnostic();
  });
});
