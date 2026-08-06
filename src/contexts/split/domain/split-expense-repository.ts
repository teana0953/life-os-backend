import type { ShareMirrorRow } from "./shares-mirror";
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

/**
 * What a write produced. `mirrors` are the rows **as they now stand in
 * storage**, which is not always what was planned: an edit keeps the category
 * of a mirror its owner recategorised, so the planned row says one category
 * and the stored row is in another. `SharesMirror.afterWrite` runs the
 * holders' budget checks off these, so it can only ever be given the stored
 * ones — checking a planned category would check a category the row is not in
 * and never the one it is (design.md D6/D19).
 */
export interface SplitExpenseWriteResult {
  expense: SplitExpense;
  mirrors: ShareMirrorRow[];
}

export interface SplitExpenseRepository {
  /**
   * Writes the expense row, its share rows, its activity entry and the share
   * holders' mirrored finance transactions in a single batch (design.md:
   * never a two-step insert that can leave an orphaned expense, never a
   * timeline that misses a change that happened, and never a mirror that
   * outlives a failed split write). The activity's actor is
   * `createdByUserId`, already part of the input.
   *
   * `mirrors` are computed by the caller (`SharesMirror.plan`) and only
   * *placed* here: this repository never decides who gets one or on which
   * category it lands. It returns them as written, see
   * `SplitExpenseWriteResult`.
   */
  create(input: CreateSplitExpenseInput, mirrors: ShareMirrorRow[]): Promise<SplitExpenseWriteResult>;
  findById(id: string): Promise<SplitExpense | null>;
  /**
   * Replaces the row and atomically swaps its shares (delete + insert in one
   * batch), together with the activity entry recording the edit — hence
   * `actorUserId`, which is not derivable from `fields`. Returns null when the
   * expense does not exist.
   *
   * The mirrors are *updated in place*, not swapped like the shares: a share
   * holder may have recategorised their own copy, and replacing the row would
   * throw that away (design.md D5/D6). Anyone no longer holding a share loses
   * their mirror in the same write. The returned mirrors are therefore the
   * stored ones, not the planned ones — see `SplitExpenseWriteResult`.
   */
  update(id: string, fields: UpdateSplitExpenseFields, mirrors: ShareMirrorRow[], now: Date, actorUserId: string): Promise<SplitExpenseWriteResult | null>;
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
