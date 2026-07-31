import { type CheckBudgetAlertsDeps, checkBudgetAlerts } from "./check-budget-alerts";
import { FinanceCategoryArchived, FinanceCategoryNotFound, FinanceCategoryTypeMismatch, FinanceTransactionNotFound } from "../domain/errors";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { FinanceTransaction, ReplaceFinanceTransactionInput } from "../domain/finance-transaction";
import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";
import { validateTransactionFields } from "./validate-transaction-fields";

/**
 * Use case: full-replace update of an owned transaction. `category_id` must
 * exist, belong to the same user, and have a matching `type`. Archived is
 * blocked ONLY when the patch actually switches `category_id` — a
 * transaction already on an archived category stays editable (amount, date,
 * note) as long as its category is unchanged (design.md). When
 * `budgetAlertDeps` is provided, a successful TWD expense write additionally
 * triggers the budget-alert check for both the old and new category when the
 * category changed (add-finance-budgets design.md) — best-effort, never
 * changing this call's result.
 */
export async function updateTransaction(
  categoryRepository: FinanceCategoryRepository,
  transactionRepository: FinanceTransactionRepository,
  userId: string,
  id: string,
  input: ReplaceFinanceTransactionInput,
  budgetAlertDeps?: CheckBudgetAlertsDeps,
): Promise<FinanceTransaction> {
  const existing = await transactionRepository.findById(id);
  if (!existing || existing.userId !== userId) throw new FinanceTransactionNotFound();

  const { type, currency } = validateTransactionFields(input.type, input.amount, input.currency);

  const category = await categoryRepository.findById(input.categoryId);
  if (!category || category.userId !== userId) throw new FinanceCategoryNotFound();
  if (category.type !== type) throw new FinanceCategoryTypeMismatch();
  const categoryChanged = input.categoryId !== existing.categoryId;
  if (category.archived && categoryChanged) throw new FinanceCategoryArchived();

  const updated = await transactionRepository.update(userId, id, { ...input, type, currency });
  if (!updated) throw new FinanceTransactionNotFound();

  if (budgetAlertDeps) {
    try {
      await checkBudgetAlerts(budgetAlertDeps, {
        userId: updated.userId,
        type: updated.type,
        currency: updated.currency,
        categoryId: updated.categoryId,
        previousCategoryId: categoryChanged ? existing.categoryId : undefined,
        date: updated.date,
      });
    } catch (err) {
      console.error("budget alert check failed", err);
    }
  }

  return updated;
}
