import { FinanceCategoryNotFound, InvalidFinanceInputError } from "../domain/errors";
import type { FinanceCategory, UpdateFinanceCategoryPatch } from "../domain/finance-category";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";

/**
 * Use case: partially update an owned category (name/icon/sort_order/
 * archived). `type` is immutable — `UpdateFinanceCategoryPatch` has no
 * `type` field, so there is no code path that could change it. A rename that
 * collides with another of the user's categories of the same type is
 * rejected with 400 (same duplicate-name guard as create).
 */
export async function updateCategory(
  repository: FinanceCategoryRepository,
  userId: string,
  id: string,
  patch: UpdateFinanceCategoryPatch,
): Promise<FinanceCategory> {
  const existing = await repository.findById(id);
  if (!existing || existing.userId !== userId) throw new FinanceCategoryNotFound();

  if (patch.name !== undefined && patch.name !== existing.name) {
    const duplicate = await repository.findByUserTypeName(userId, existing.type, patch.name);
    if (duplicate) {
      throw new InvalidFinanceInputError(`a ${existing.type} category named "${patch.name}" already exists`);
    }
  }

  const updated = await repository.update(userId, id, patch);
  if (!updated) throw new FinanceCategoryNotFound();
  return updated;
}
