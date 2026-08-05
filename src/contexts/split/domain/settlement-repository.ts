import type { CreateSettlementInput, Settlement } from "./settlement";

/**
 * Exactly one of `groupId`/`withUserId` may be set (validated by the use
 * case, not here) — same filtering semantics as `ListExpensesFilter`.
 */
export interface ListSettlementsFilter {
  groupId?: string;
  withUserId?: string;
}

export interface SettlementRepository {
  /** Writes the settlement and its activity entry in one batch. The activity's actor is `createdByUserId`, already part of the input. */
  create(input: CreateSettlementInput): Promise<Settlement>;
  findById(id: string): Promise<Settlement | null>;
  /**
   * Returns whether a row was deleted. `actorUserId` is who deleted it: the
   * activity entry is written in the same batch, conditional on the delete
   * matching a row. `now` is that entry's `created_at`: the caller's clock, the
   * same one every other write path uses, never the database's.
   */
  delete(id: string, actorUserId: string, now: Date): Promise<boolean>;
  /**
   * `userId`'s settlements matching `filter`, scoped to participation in the
   * query. The use case re-checks participation on every row regardless —
   * this repository's SQL path has no test coverage in this repo (same
   * accepted gap as `SplitExpenseRepository.listForUser`), so it must not be
   * the only thing standing between a mistake here and another user's
   * settlements leaking.
   */
  listForUser(userId: string, filter: ListSettlementsFilter): Promise<Settlement[]>;
}
