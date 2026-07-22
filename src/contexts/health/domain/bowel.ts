export interface BowelLog {
  userId: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  day: string;
  /** Number of bowel movements that day (non-negative integer). */
  count: number;
  /** Normal/abnormal flag; null means not recorded. */
  isNormal: boolean | null;
  /** Free-text note (empty string when none). */
  note: string;
}
