import type { CreateSplitExpenseInput, SplitExpense, UpdateSplitExpenseFields } from "./split-expense";

/**
 * Exactly one of `groupId`/`withUserId` may be set (validated by the use
 * case, not here) — "the caller's expenses in this group" and "the caller's
 * groupless expenses with this person" are different questions.
 */
export interface ListExpensesFilter {
  groupId?: string;
  withUserId?: string;
}

export interface SplitExpenseRepository {
  /** Writes the expense row and its share rows in a single batch (design.md: never a two-step insert that can leave an orphaned expense). */
  create(input: CreateSplitExpenseInput): Promise<SplitExpense>;
  findById(id: string): Promise<SplitExpense | null>;
  /** Replaces the row and atomically swaps its shares (delete + insert in one batch). Returns null when the expense does not exist. */
  update(id: string, fields: UpdateSplitExpenseFields, now: Date): Promise<SplitExpense | null>;
  /** Returns whether a row was deleted. */
  delete(id: string): Promise<boolean>;
  /**
   * `userId`'s expenses matching `filter`, already scoped to participation in
   * the query (design.md: an `EXISTS` on `split_share`, not a post-filter).
   * The use case re-checks participation on every row regardless — this
   * repository's SQL path has no test coverage in this repo (see design.md's
   * accepted gap), so it must not be the only thing standing between a
   * mistake here and another user's expenses leaking.
   */
  listForUser(userId: string, filter: ListExpensesFilter): Promise<SplitExpense[]>;
}
