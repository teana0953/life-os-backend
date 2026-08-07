export interface CurrencyBalance {
  currency: string;
  /** Positive = they owe the viewer; negative = the viewer owes them. Never zero — zero-net currencies are omitted (design.md). */
  amount: number;
  /**
   * Repayment-schedule progress (split-installments proposal.md): which
   * period is next, of how many, and that period's amount. Absent when
   * nothing behind this figure is on a schedule — never zeroed, since a
   * zeroed value would be indistinguishable from "the schedule finished".
   * Does not affect `amount`: a schedule says when the money moves, not
   * whether the debt exists.
   */
  schedule?: { nextPeriod: number; totalPeriods: number; periodAmount: number };
}

/** Outward-facing net balance against one other person (personal) or one member's net against a whole group (group balances). */
export interface Balance {
  userId: string;
  displayName: string;
  balances: CurrencyBalance[];
}
