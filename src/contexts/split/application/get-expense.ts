import { ExpenseNotFound } from "../domain/errors";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { SplitExpense } from "../domain/split-expense";
import type { SplitExpenseRepository } from "../domain/split-expense-repository";
import { isParticipant } from "./participation";

export interface GetExpenseDeps {
  expenses: SplitExpenseRepository;
  groups: ExpenseGroupRepository;
}

/** Use case: read one expense. Visible only to its payer, a share holder, or — for a grouped expense — that group's members; anyone else gets `ExpenseNotFound`. */
export async function getExpense(deps: GetExpenseDeps, callerUserId: string, expenseId: string): Promise<SplitExpense> {
  const expense = await deps.expenses.findById(expenseId);
  if (!expense) throw new ExpenseNotFound();
  if (!(await isParticipant(deps.groups, expense, callerUserId))) throw new ExpenseNotFound();
  return expense;
}
