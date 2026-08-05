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
  /**
   * Writes the expense row, its share rows and its activity entry in a single
   * batch (design.md: never a two-step insert that can leave an orphaned
   * expense, and never a timeline that misses a change that happened). The
   * activity's actor is `createdByUserId`, already part of the input.
   */
  create(input: CreateSplitExpenseInput): Promise<SplitExpense>;
  findById(id: string): Promise<SplitExpense | null>;
  /**
   * Replaces the row and atomically swaps its shares (delete + insert in one
   * batch), together with the activity entry recording the edit — hence
   * `actorUserId`, which is not derivable from `fields`. Returns null when the
   * expense does not exist.
   */
  update(id: string, fields: UpdateSplitExpenseFields, now: Date, actorUserId: string): Promise<SplitExpense | null>;
  /**
   * Returns whether a row was deleted. `actorUserId` is who deleted it: the
   * activity entry is written in the same batch, conditional on the delete
   * matching a row, so a concurrent double-delete cannot record it twice.
   * `now` is that entry's `created_at`: the caller's clock, the same one every
   * other write path uses, never the database's.
   */
  delete(id: string, actorUserId: string, now: Date): Promise<boolean>;
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
