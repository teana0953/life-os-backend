/** Caller-supplied split instructions before the amounts are computed/validated. */
export type SplitInput =
  | { mode: "equal"; participantUserIds: string[] }
  | { mode: "exact"; shares: { userId: string; amount: number; schedule?: { periods: number; perPeriodAmount: number } }[] };

export interface CreateExpenseInput {
  callerUserId: string;
  groupId: string | null;
  payerUserId: string;
  amount: number;
  currency: string;
  description: string;
  day: string;
  /** Optional; absent is the same as `null`. Validated (and empty-string-normalized) by `validateExpenseFields`. */
  categoryName?: unknown;
  split: SplitInput;
}

/**
 * `groupId`, when given, must equal the expense's current group — the field
 * exists only so an attempt to change it can be rejected (design.md: moving
 * an expense between groups is a new expense, not an edit). There is no
 * `createdByUserId` field at all: it is immutable and never accepted as
 * input.
 */
export interface UpdateExpenseInput {
  payerUserId: string;
  amount: number;
  currency: string;
  description: string;
  day: string;
  /** Optional; absent is the same as `null`. Validated (and empty-string-normalized) by `validateExpenseFields`. */
  categoryName?: unknown;
  split: SplitInput;
  groupId?: string | null;
}
