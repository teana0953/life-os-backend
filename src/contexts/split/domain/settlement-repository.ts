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
  create(input: CreateSettlementInput): Promise<Settlement>;
  findById(id: string): Promise<Settlement | null>;
  /** Returns whether a row was deleted. */
  delete(id: string): Promise<boolean>;
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
