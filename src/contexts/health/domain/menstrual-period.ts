export interface MenstrualPeriod {
  id: string;
  userId: string;
  /** ISO calendar date, e.g. "2026-05-01". */
  startDate: string;
  /** ISO calendar date; null while the period is still open (not yet ended). */
  endDate: string | null;
}

/** The dates of a period — anything with a start and a possibly-open end. */
export interface PeriodDates {
  startDate: string;
  endDate: string | null;
}

/**
 * Whether two periods share any day, treating both as inclusive `[start, end]`
 * spans and a null `endDate` (still open) as reaching indefinitely forward.
 *
 * Symmetric by construction: two spans miss only if one ends strictly before the
 * other starts. A one-sided rule ("the later one starts after the earlier one
 * ends") gets the day-apart case wrong in one of its two directions — which is
 * the very case overlap, rather than an equal start date, is being tested for.
 * ISO `YYYY-MM-DD` strings compare correctly as strings.
 */
export function periodsOverlap(a: PeriodDates, b: PeriodDates): boolean {
  const aEndsFirst = a.endDate !== null && a.endDate < b.startDate;
  const bEndsFirst = b.endDate !== null && b.endDate < a.startDate;
  return !aEndsFirst && !bEndsFirst;
}
