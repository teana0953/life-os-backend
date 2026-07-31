import type { FinanceCategory } from "../domain/finance-category";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import { ensureDefaultCategories } from "./ensure-default-categories";

/** Use case: list the user's categories, lazily seeding the defaults first when the user has none. */
export async function listCategories(repository: FinanceCategoryRepository, userId: string): Promise<FinanceCategory[]> {
  await ensureDefaultCategories(repository, userId);
  return repository.listByUser(userId);
}
