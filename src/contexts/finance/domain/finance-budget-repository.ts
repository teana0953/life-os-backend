import type { FinanceBudget, UpsertFinanceBudgetInput } from "./finance-budget";

export interface BudgetWithSpent {
  budget: FinanceBudget;
  spent: number;
}

export interface TryRecordAlertInput {
  userId: string;
  budgetId: string;
  month: string;
  threshold: number;
}

export interface FinanceBudgetRepository {
  /** Upsert semantics keyed by (userId, categoryId): updates the amount if a budget already exists for that scope, else creates it. */
  upsert(input: UpsertFinanceBudgetInput): Promise<FinanceBudget>;
  findByUserAndCategory(userId: string, categoryId: string | null): Promise<FinanceBudget | null>;
  /** Owner-scoped delete; its alerts cascade via FK. Returns whether a row was deleted. */
  delete(userId: string, id: string): Promise<boolean>;
  /**
   * Every one of `userId`'s budgets with that month's TWD expense `spent`
   * (SQL-aggregated) — the overall budget's scope is every category, a
   * category budget's scope is just that category.
   */
  listWithSpent(userId: string, month: string): Promise<BudgetWithSpent[]>;
  /** TWD expense sum for `userId` in `month`, scoped to `categoryId` (null = every category). */
  getSpent(userId: string, categoryId: string | null, month: string): Promise<number>;
  /**
   * Insert-if-absent for (budgetId, month, threshold) — the alert dedup
   * record. Returns `true` when the insert won (safe to notify, including
   * under concurrent writes) and `false` when the alert was already
   * recorded.
   */
  tryRecordAlert(input: TryRecordAlertInput): Promise<boolean>;
}
