import { ExpenseNotFound } from "../domain/errors";
import type { SplitExpenseRepository } from "../domain/split-expense-repository";

/** Use case: delete an owned expense. Only `created_by_user_id` or `payer_user_id` may — any other participant gets `ExpenseNotFound`. */
export async function deleteExpense(repository: SplitExpenseRepository, callerUserId: string, expenseId: string, now: Date = new Date()): Promise<void> {
  const caller = callerUserId.toLowerCase();

  const existing = await repository.findById(expenseId);
  if (!existing) throw new ExpenseNotFound();
  if (existing.createdByUserId !== caller && existing.payerUserId !== caller) throw new ExpenseNotFound();

  const deleted = await repository.delete(expenseId, caller, now);
  if (!deleted) throw new ExpenseNotFound();
}
