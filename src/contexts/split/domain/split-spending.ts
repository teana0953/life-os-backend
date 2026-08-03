/**
 * One currency's total for `getSplitSpending`: what the user personally owed
 * on split expenses in a month — the sum of their own `split_share` rows,
 * never a `finance_transaction` (design.md — read-time aggregation, nothing
 * to reconcile).
 */
export interface SplitSpendingAmount {
  currency: string;
  amount: number;
}
