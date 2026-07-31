import { InvalidFinanceInputError } from "../domain/errors";
import type { BudgetProgress } from "../domain/finance-budget";
import type { FinanceBudgetRepository } from "../domain/finance-budget-repository";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Use case: every one of the user's budgets with that month's progress
 * (`spent`/`remaining`/`percent`), scoped per budget (overall = all
 * categories, category budget = that category). `spent` is SQL-aggregated by
 * the repository, TWD-expense-only (design.md).
 */
export async function listBudgetsWithProgress(repository: FinanceBudgetRepository, userId: string, month: string): Promise<BudgetProgress[]> {
  if (!MONTH_RE.test(month)) throw new InvalidFinanceInputError(`month must be a valid month (YYYY-MM): ${month}`);

  const rows = await repository.listWithSpent(userId, month);
  return rows.map(({ budget, spent }) => ({
    id: budget.id,
    categoryId: budget.categoryId,
    amount: budget.amount,
    spent,
    remaining: budget.amount - spent,
    percent: Math.round((spent / budget.amount) * 100),
  }));
}
