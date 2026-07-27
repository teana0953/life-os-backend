/**
 * Number of days in one chaodays fetch batch. chaodays rejects a request whose
 * range is too long, so a longer import range is fetched as several requests of
 * at most this many days. A fixed day count (rather than "six calendar months")
 * keeps the split points predictable — calendar arithmetic has month-end holes.
 */
export const CHAODAYS_BATCH_DAYS = 183;

/** An inclusive `[from, to]` range of ISO calendar dates, e.g. "2026-07-18". */
export interface DateRange {
  from: string;
  to: string;
}

/** `YYYY-MM-DD` plus `days`, computed in UTC so a local DST shift can't lose a day. */
function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/**
 * Splits the inclusive range `[from, to]` into contiguous, non-overlapping
 * batches of at most [CHAODAYS_BATCH_DAYS] days that together cover exactly the
 * requested range. A range within the batch size yields a single batch equal to
 * the range itself.
 */
export function splitDateRange(from: string, to: string): DateRange[] {
  const batches: DateRange[] = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, CHAODAYS_BATCH_DAYS - 1);
    batches.push({ from: start, to: end < to ? end : to });
    start = addDays(start, CHAODAYS_BATCH_DAYS);
  }
  return batches;
}
