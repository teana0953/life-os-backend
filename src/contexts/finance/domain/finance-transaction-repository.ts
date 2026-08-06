import type { CreateFinanceTransactionInput, FinanceTransaction, SplitFactsSnapshot, UpdateFinanceTransactionFields } from "./finance-transaction";
import type { MonthlySummaryRaw } from "./monthly-summary";

export interface FinanceTransactionRepository {
  create(input: CreateFinanceTransactionInput): Promise<FinanceTransaction>;
  findById(id: string): Promise<FinanceTransaction | null>;
  /** The user's transactions with `date` in `[from, to]` (inclusive). */
  listByUserAndRange(userId: string, from: string, to: string): Promise<FinanceTransaction[]>;
  /**
   * Owner-scoped full replace; returns null when not owned/found.
   *
   * `expected`, when given, additionally requires the row to still hold those
   * values — the split's own facts, as the caller compared them before
   * deciding the edit was permitted. It is what stops a concurrent split edit
   * from being silently reverted (design.md D7); null then means "no row
   * matched", which the caller distinguishes from "no row exists".
   */
  update(userId: string, id: string, input: UpdateFinanceTransactionFields, expected?: SplitFactsSnapshot): Promise<FinanceTransaction | null>;
  /** Owner-scoped delete; returns whether a row was deleted. */
  delete(userId: string, id: string): Promise<boolean>;
  /** SQL-aggregated raw sums for `userId`'s transactions in `month` (`YYYY-MM`). */
  getMonthlySummaryRaw(userId: string, month: string): Promise<MonthlySummaryRaw>;
}
