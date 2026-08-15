/**
 * An instalment plan (openspec/changes/archive/2026-08-07-add-installments): a fixed-count,
 * real-charge schedule — N ordinary transactions, one per month, anchored on
 * the start day. The plan row records HOW the transactions were generated; it
 * is never an accounting invariant. In particular "plan amount = sum of its
 * instalments" is deliberately NOT maintained once the user deletes or edits
 * a single instalment (design.md D2/D2b) — every money computation must read
 * the existing transaction rows, never this record.
 */
export type InstallmentPlanMode = "total" | "per_installment";

export interface InstallmentPlan {
  id: string;
  userId: string;
  /**
   * `total`: the user gave a total, the system divided it (credit-card path).
   * `per_installment`: the user copied the bank's per-instalment amount and
   * it is used exactly as given — never divided, never recomputed (D0).
   */
  mode: InstallmentPlanMode;
  periods: number;
  /** First instalment's date (`YYYY-MM-DD`) — the anchor every later month is computed from (D3). */
  startDay: string;
  /**
   * The creation-time input: the total (mode `total`) or the per-instalment
   * amount (mode `per_installment`). A record of what was entered, only —
   * it takes part in no calculation (D2b).
   */
  amount: number;
  currency: string;
  categoryId: string;
  note: string | null;
}

export interface CreateInstallmentPlanRecord {
  userId: string;
  mode: InstallmentPlanMode;
  periods: number;
  startDay: string;
  amount: number;
  currency: string;
  categoryId: string;
  note?: string | null;
}

/** One instalment transaction to write: the use case computes these; the repository only stores them. */
export interface InstallmentRow {
  installmentNo: number;
  /** `YYYY-MM-DD` */
  day: string;
  amount: number;
}

/** The single transaction an early settlement inserts, dated the user's today. */
export interface InstallmentSettlementRow {
  /** `YYYY-MM-DD` — the user's (timezone-local) today. */
  day: string;
  amount: number;
  currency: string;
  categoryId: string;
  note?: string | null;
}
