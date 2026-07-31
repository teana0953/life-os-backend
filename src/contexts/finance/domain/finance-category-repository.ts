import type { CreateFinanceCategoryInput, FinanceCategory, FinanceCategoryType, UpdateFinanceCategoryPatch } from "./finance-category";

export interface FinanceCategoryRepository {
  /** All of the user's categories (including archived), in `sort_order` order. */
  listByUser(userId: string): Promise<FinanceCategory[]>;
  findById(id: string): Promise<FinanceCategory | null>;
  findByUserTypeName(userId: string, type: FinanceCategoryType, name: string): Promise<FinanceCategory | null>;
  create(input: CreateFinanceCategoryInput): Promise<FinanceCategory>;
  /** Owner-scoped partial update; returns null when not owned/found. */
  update(userId: string, id: string, patch: UpdateFinanceCategoryPatch): Promise<FinanceCategory | null>;
  /**
   * Idempotently inserts the given defaults for `userId`, ignoring any that
   * already exist (the `(user_id, type, name)` unique index is the
   * concurrency guard — this is the safety net behind the application-layer
   * "seed only if the user has none" check in `ensureDefaultCategories`).
   */
  insertDefaultsIfMissing(defaults: CreateFinanceCategoryInput[]): Promise<void>;
}
