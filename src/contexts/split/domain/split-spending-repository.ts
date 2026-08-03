import type { SplitSpendingAmount } from "./split-spending";

/**
 * A separate port from `SplitExpenseRepository` on purpose: `getSplitSpending`
 * needs exactly this one read, and keeping it as its own interface means
 * adding it (in part 2, to `DrizzleSplitExpenseRepository` or wherever it
 * ends up implemented) never forces every other `SplitExpenseRepository`
 * implementer — including this repo's existing Drizzle adapter and test
 * stubs — to grow a matching method in the meantime.
 */
export interface SplitSpendingRepository {
  /**
   * `userId`'s own share total per currency for expenses whose `day` falls in
   * `month` (`YYYY-MM`, same `to_char(day, 'YYYY-MM')` filter as finance's
   * monthly summary). Currency lives on `split_expense`, not `split_share`,
   * so the query must join. Aggregated in SQL, GROUP BY currency — never by
   * loading every share into memory.
   *
   * Deliberately counts the payer's own share (they really spent it), unlike
   * `BalanceRepository`, which excludes it because it answers a different
   * question ("who owes whom" vs. "what did I spend"). Settlements never
   * appear here at all — they live in a separate table
   * (`split_settlement`), so there is nothing to filter out.
   */
  splitSpendingForUser(userId: string, month: string): Promise<SplitSpendingAmount[]>;
}
