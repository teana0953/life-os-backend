import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceSharesMirror } from "../../../../src/contexts/finance/adapters/finance-shares-mirror";
import type { ShareMirrorRow } from "../../../../src/contexts/split/domain/shares-mirror";
import { FakeBudgetAlertNotifier, InMemoryFinanceBudgetRepository, InMemoryFinanceCategoryRepository, InMemoryFinanceTransactionRepository } from "../fakes";
import {
  DIAGNOSTIC_PG_CODE,
  SECRET_PARAM_VALUE,
  SECRET_ROW_VALUE,
  drizzleQueryErrorWithPgCause,
} from "../../../helpers/drizzle-error";
import { loggedTextFrom } from "../../../helpers/logged-text";

const HOLDER = "22222222-2222-2222-2222-222222222222";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function mirrorWithFailingBudgets(): FinanceSharesMirror {
  const transactions = new InMemoryFinanceTransactionRepository();
  const budgets = new InMemoryFinanceBudgetRepository(transactions);
  return new FinanceSharesMirror({
    categories: new InMemoryFinanceCategoryRepository(),
    budgets: {
      upsert: budgets.upsert.bind(budgets),
      findByUserAndCategory: async (): Promise<never> => {
        throw drizzleQueryErrorWithPgCause();
      },
      delete: budgets.delete.bind(budgets),
      listWithSpent: budgets.listWithSpent.bind(budgets),
      getSpent: budgets.getSpent.bind(budgets),
      tryRecordAlert: budgets.tryRecordAlert.bind(budgets),
    },
    notifier: new FakeBudgetAlertNotifier(),
  });
}

function row(): ShareMirrorRow {
  return {
    userId: HOLDER,
    splitExpenseId: "e1111111-1111-1111-1111-111111111111",
    amount: 500,
    currency: "TWD",
    categoryId: "c1111111-1111-1111-1111-111111111111",
    day: "2026-04-01",
    note: null,
  };
}

describe("FinanceSharesMirror.afterWrite logging", () => {
  it("redacts the DB error while keeping the pg diagnostic", async () => {
    await mirrorWithFailingBudgets().afterWrite([row()]);

    const text = loggedTextFrom(errorSpy);
    expect(text).not.toContain(SECRET_PARAM_VALUE);
    expect(text).not.toContain(SECRET_ROW_VALUE);
    expect(text).toContain(DIAGNOSTIC_PG_CODE);
    expect(text).toContain("invalid input syntax for type uuid");
  });

  it("keeps the failing holder's userId — the catch is inside a per-row loop, so without it a repeated failure cannot be told from several holders failing once", async () => {
    await mirrorWithFailingBudgets().afterWrite([row()]);

    const text = loggedTextFrom(errorSpy);
    expect(text).toContain(HOLDER);
  });
});
