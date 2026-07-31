import type { CreateFinanceTransactionInput, FinanceTransaction, ReplaceFinanceTransactionInput } from "./finance-transaction";
import type { MonthlySummaryRaw } from "./monthly-summary";

export interface FinanceTransactionRepository {
  create(input: CreateFinanceTransactionInput): Promise<FinanceTransaction>;
  findById(id: string): Promise<FinanceTransaction | null>;
  /** The user's transactions with `date` in `[from, to]` (inclusive). */
  listByUserAndRange(userId: string, from: string, to: string): Promise<FinanceTransaction[]>;
  /** Owner-scoped full replace; returns null when not owned/found. */
  update(userId: string, id: string, input: ReplaceFinanceTransactionInput): Promise<FinanceTransaction | null>;
  /** Owner-scoped delete; returns whether a row was deleted. */
  delete(userId: string, id: string): Promise<boolean>;
  /** SQL-aggregated raw sums for `userId`'s transactions in `month` (`YYYY-MM`). */
  getMonthlySummaryRaw(userId: string, month: string): Promise<MonthlySummaryRaw>;
}
