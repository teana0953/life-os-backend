export interface FinanceBudget {
  id: string;
  userId: string;
  /** null = the user's overall (all-category) monthly budget. */
  categoryId: string | null;
  /** TWD, positive integer. */
  amount: number;
}

export interface UpsertFinanceBudgetInput {
  userId: string;
  categoryId: string | null;
  amount: number;
}

/** One budget's progress for a given month, as returned by `listBudgetsWithProgress`. */
export interface BudgetProgress {
  id: string;
  categoryId: string | null;
  amount: number;
  spent: number;
  /** `amount - spent`; may be negative. */
  remaining: number;
  percent: number;
}
