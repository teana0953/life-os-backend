export type FinanceCategoryType = "expense" | "income";

export interface FinanceCategory {
  id: string;
  userId: string;
  name: string;
  type: FinanceCategoryType;
  icon: string;
  sortOrder: number;
  archived: boolean;
}

export interface CreateFinanceCategoryInput {
  userId: string;
  name: string;
  type: FinanceCategoryType;
  icon?: string;
  sortOrder?: number;
}

/** Partial-update patch: `type` is intentionally absent — a category's type is immutable after creation. */
export interface UpdateFinanceCategoryPatch {
  name?: string;
  icon?: string;
  sortOrder?: number;
  archived?: boolean;
}
