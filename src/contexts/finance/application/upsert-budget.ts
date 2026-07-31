import { FinanceCategoryArchived, FinanceCategoryNotFound, FinanceCategoryTypeMismatch, InvalidFinanceInputError } from "../domain/errors";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { FinanceBudget, UpsertFinanceBudgetInput } from "../domain/finance-budget";
import type { FinanceBudgetRepository } from "../domain/finance-budget-repository";

/**
 * Use case: upsert a recurring monthly budget. `amount` must be a positive
 * integer. `category_id: null` means the user's overall budget; a non-null
 * `category_id` must exist, belong to the same user, be an `expense`
 * category, and not be archived (design.md). Upsert semantics: updates the
 * amount if a budget for that scope already exists, else creates it.
 */
export async function upsertBudget(
  categoryRepository: FinanceCategoryRepository,
  budgetRepository: FinanceBudgetRepository,
  input: UpsertFinanceBudgetInput,
): Promise<FinanceBudget> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new InvalidFinanceInputError(`amount must be a positive integer: ${input.amount}`);
  }

  if (input.categoryId !== null) {
    const category = await categoryRepository.findById(input.categoryId);
    if (!category || category.userId !== input.userId) throw new FinanceCategoryNotFound();
    if (category.type !== "expense") throw new FinanceCategoryTypeMismatch();
    if (category.archived) throw new FinanceCategoryArchived();
  }

  return budgetRepository.upsert(input);
}
