import type { FinanceCategoryType } from "./finance-category";

export type FinanceTransactionType = FinanceCategoryType;

export interface FinanceTransaction {
  id: string;
  userId: string;
  type: FinanceTransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  date: string;
  note: string | null;
}

export interface CreateFinanceTransactionInput {
  userId: string;
  type: FinanceTransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  date: string;
  note?: string | null;
}

/** PUT is full-replace semantics (design.md): every field is required, including `currency`. */
export interface ReplaceFinanceTransactionInput {
  type: FinanceTransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  date: string;
  note?: string | null;
}
