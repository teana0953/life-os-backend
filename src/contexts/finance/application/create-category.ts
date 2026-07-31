import { InvalidFinanceInputError } from "../domain/errors";
import type { CreateFinanceCategoryInput, FinanceCategory } from "../domain/finance-category";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";

/**
 * Use case: create a category. Validates `type` and rejects a duplicate
 * (user, type, name) with 400 by checking first — never lets the
 * `(user_id, type, name)` unique-index violation surface as a raw 500
 * (design.md).
 */
export async function createCategory(repository: FinanceCategoryRepository, input: CreateFinanceCategoryInput): Promise<FinanceCategory> {
  if (input.type !== "expense" && input.type !== "income") {
    throw new InvalidFinanceInputError(`type must be "expense" or "income": ${input.type}`);
  }

  const duplicate = await repository.findByUserTypeName(input.userId, input.type, input.name);
  if (duplicate) {
    throw new InvalidFinanceInputError(`a ${input.type} category named "${input.name}" already exists`);
  }

  return repository.create(input);
}
