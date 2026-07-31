import { type CheckBudgetAlertsDeps, checkBudgetAlerts } from "./check-budget-alerts";
import { FinanceCategoryArchived, FinanceCategoryNotFound, FinanceCategoryTypeMismatch } from "../domain/errors";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { CreateFinanceTransactionInput, FinanceTransaction } from "../domain/finance-transaction";
import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";
import { validateTransactionFields } from "./validate-transaction-fields";

/**
 * Use case: create a transaction. `category_id` must exist, belong to the
 * same user, have a matching `type`, and NOT be archived (create always
 * blocks archived categories — unlike update, which only blocks when
 * switching onto one, design.md). When `budgetAlertDeps` is provided, a
 * successful TWD expense write additionally triggers the budget-alert check
 * (add-finance-budgets design.md) best-effort: any failure is caught and
 * logged, never changing this call's result.
 */
export async function createTransaction(
  categoryRepository: FinanceCategoryRepository,
  transactionRepository: FinanceTransactionRepository,
  input: CreateFinanceTransactionInput,
  budgetAlertDeps?: CheckBudgetAlertsDeps,
): Promise<FinanceTransaction> {
  const { type, currency } = validateTransactionFields(input.type, input.amount, input.currency);

  const category = await categoryRepository.findById(input.categoryId);
  if (!category || category.userId !== input.userId) throw new FinanceCategoryNotFound();
  if (category.type !== type) throw new FinanceCategoryTypeMismatch();
  if (category.archived) throw new FinanceCategoryArchived();

  const transaction = await transactionRepository.create({ ...input, type, currency });

  if (budgetAlertDeps) {
    try {
      await checkBudgetAlerts(budgetAlertDeps, {
        userId: transaction.userId,
        type: transaction.type,
        currency: transaction.currency,
        categoryId: transaction.categoryId,
        date: transaction.date,
      });
    } catch (err) {
      console.error("budget alert check failed", err);
    }
  }

  return transaction;
}
