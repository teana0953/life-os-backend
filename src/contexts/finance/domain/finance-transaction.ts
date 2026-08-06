import type { FinanceCategoryType } from "./finance-category";

export type FinanceTransactionType = FinanceCategoryType;

/**
 * Where a transaction's category came from: `'mirror'` while it still follows
 * the split expense it was created from, `'manual'` once its owner picked the
 * category themselves — after which a later split edit must leave it alone
 * (design.md D6). Every non-mirrored transaction is `'manual'`.
 */
export type FinanceCategorySource = "mirror" | "manual";

export interface FinanceTransaction {
  id: string;
  userId: string;
  type: FinanceTransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  date: string;
  note: string | null;
  /** The split expense this is a mirror of, or `null` for an ordinary transaction. Never settable through the finance API (design.md D17). */
  splitExpenseId: string | null;
  categorySource: FinanceCategorySource;
}

export interface CreateFinanceTransactionInput {
  userId: string;
  type: FinanceTransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  date: string;
  note?: string | null;
  /**
   * Only the split mirror write path sets these, and it does not go through
   * this repository in production — the mirrors travel in split's own
   * `db.batch`. They are here so the in-memory repository the HTTP tests run
   * on can represent the same rows. Never read from a request body (D17).
   */
  splitExpenseId?: string | null;
  categorySource?: FinanceCategorySource;
}

/**
 * PUT is full-replace semantics (design.md): every field is required,
 * including `currency`. `splitExpenseId` is deliberately absent: it is spread
 * straight into the repository update, so a field here that the handler
 * forgot to fill would clear a mirror's link to its split — and a field the
 * handler read from the body would let a client attach or detach one at will
 * (design.md D17).
 */
export interface ReplaceFinanceTransactionInput {
  type: FinanceTransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  date: string;
  note?: string | null;
}

/**
 * What the repository's update actually writes. `categorySource` is computed
 * by the use case — a mirror whose owner just picked a category by hand — and
 * has no field in the request body, so no client can hand a value in
 * (design.md D6/D17). Absent means "leave the column as it is".
 */
export interface UpdateFinanceTransactionFields extends ReplaceFinanceTransactionInput {
  categorySource?: FinanceCategorySource;
}
