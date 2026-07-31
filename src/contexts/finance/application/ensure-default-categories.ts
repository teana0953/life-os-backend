import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";

/**
 * Use case: seed the user's default categories the first time they have none
 * at all (including archived) — never re-seeds once any category exists,
 * default or user-created. Idempotent: the repository's
 * `insertDefaultsIfMissing` skips rows that already exist, so a concurrent
 * double-call never duplicates.
 */
export async function ensureDefaultCategories(repository: FinanceCategoryRepository, userId: string): Promise<void> {
  const existing = await repository.listByUser(userId);
  if (existing.length > 0) return;
  await repository.insertDefaultsIfMissing(
    userId,
    DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })),
  );
}
