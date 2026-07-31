import { FinanceCategoryArchived, FinanceCategoryNotFound, FinanceCategoryTypeMismatch } from "../domain/errors";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { CreateFinanceTransactionInput, FinanceTransaction } from "../domain/finance-transaction";
import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";
import { validateTransactionFields } from "./validate-transaction-fields";

/**
 * Use case: create a transaction. `category_id` must exist, belong to the
 * same user, have a matching `type`, and NOT be archived (create always
 * blocks archived categories — unlike update, which only blocks when
 * switching onto one, design.md).
 */
export async function createTransaction(
  categoryRepository: FinanceCategoryRepository,
  transactionRepository: FinanceTransactionRepository,
  input: CreateFinanceTransactionInput,
): Promise<FinanceTransaction> {
  const { type, currency } = validateTransactionFields(input.type, input.amount, input.currency);

  const category = await categoryRepository.findById(input.categoryId);
  if (!category || category.userId !== input.userId) throw new FinanceCategoryNotFound();
  if (category.type !== type) throw new FinanceCategoryTypeMismatch();
  if (category.archived) throw new FinanceCategoryArchived();

  return transactionRepository.create({ ...input, type, currency });
}
