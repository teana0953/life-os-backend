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
 * note) as long as its category is unchanged (design.md).
 */
export async function updateTransaction(
  categoryRepository: FinanceCategoryRepository,
  transactionRepository: FinanceTransactionRepository,
  userId: string,
  id: string,
  input: ReplaceFinanceTransactionInput,
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
  return updated;
}
