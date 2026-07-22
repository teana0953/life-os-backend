export interface MenstrualPeriod {
  id: string;
  userId: string;
  /** ISO calendar date, e.g. "2026-05-01". */
  startDate: string;
  /** ISO calendar date; null while the period is still open (not yet ended). */
  endDate: string | null;
}
