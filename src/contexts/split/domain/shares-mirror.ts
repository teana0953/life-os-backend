/**
 * The port through which a split expense reaches every share holder's
 * personal ledger (design.md D2).
 *
 * **It lives in split's domain and is implemented by finance**, so the
 * dependency points finance -> split and split's domain/application never
 * import `contexts/finance/`. The rows it produces are handed to
 * `SplitExpenseRepository`, which only puts them in the write batch: what a
 * mirror contains, who gets one, and which category it lands on are decided
 * here, in a layer a test can observe without a database.
 *
 * Deciding this inside the Drizzle adapter instead would put it out of reach
 * of both the budget-alert check (which lives in the application layer) and
 * every HTTP-level test (which runs on the in-memory repository).
 */

/** One share holder's mirrored finance transaction, ready to be written. */
export interface ShareMirrorRow {
  userId: string;
  splitExpenseId: string;
  amount: number;
  currency: string;
  /** Already resolved to *this* holder's own category — categories are per-user. */
  categoryId: string;
  /** `YYYY-MM-DD`, the split's day. */
  day: string;
  note: string | null;
  /**
   * 1-based position within a repayment schedule (split-installments
   * proposal.md), absent for an ordinary lump mirror — presence is what
   * distinguishes "part of a schedule" from "not", never a stubbed `0`.
   */
  installmentNo?: number;
}

/**
 * The facts about a split that `plan` needs. `splitExpenseId` must already
 * exist when this is called: the mirrors reference it, so the id is generated
 * by the use case before the write rather than by the repository.
 */
export interface MirrorPlanInput {
  splitExpenseId: string;
  currency: string;
  day: string;
  description: string;
  categoryName: string | null;
  shares: { userId: string; amount: number; schedule?: { periods: number; perPeriodAmount: number } }[];
}

export interface SharesMirror {
  /**
   * Resolves each share holder's category and decides who gets a mirror at
   * all. Called before the batch write — and it may itself write (seeding a
   * holder's default categories), which the batch cannot roll back (D3).
   */
  plan(input: MirrorPlanInput): Promise<ShareMirrorRow[]>;
  /**
   * Called after the batch write succeeds. Best-effort: a failure here must
   * never fail the split write.
   */
  afterWrite(rows: ShareMirrorRow[]): Promise<void>;
}
