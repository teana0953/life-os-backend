import { InvalidFinanceInputError } from "../domain/errors";

/** House limit for a plan's period count — a mortgage is 360, not 1000 (design.md D3b, tasks 0b.2). Input validation only, NOT a workaround for any batch statement limit: that is solved separately by keeping every write's statement count independent of the period count. */
export const MAX_INSTALLMENT_PERIODS = 360;

/** A positive integer count of periods, capped at `MAX_INSTALLMENT_PERIODS`. */
export function assertValidPeriods(periods: number): number {
  if (!Number.isInteger(periods) || periods <= 0) {
    throw new InvalidFinanceInputError(`periods must be a positive integer: ${periods}`);
  }
  if (periods > MAX_INSTALLMENT_PERIODS) {
    throw new InvalidFinanceInputError(`periods must be at most ${MAX_INSTALLMENT_PERIODS}: ${periods}`);
  }
  return periods;
}

/**
 * Splits `total` across `periods` instalments so they sum to exactly `total`:
 * the EARLIEST instalments carry one extra minor unit each (design.md D4),
 * not the last one, so no single instalment looks anomalously large.
 *
 * Throws when `total` is too small to give every instalment at least one
 * minor unit (design.md D4b / tasks 0b.3): dividing 10 across 12 periods
 * would otherwise silently produce zero-amount instalments that
 * `validateTransactionFields` would go on to reject with a confusing message
 * far from where the real problem is.
 */
export function divideEvenly(total: number, periods: number): number[] {
  const base = Math.floor(total / periods);
  if (base <= 0) {
    throw new InvalidFinanceInputError(`${total} does not divide into ${periods} instalments of at least 1`);
  }
  const remainder = total - base * periods;
  return Array.from({ length: periods }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * `startDay + months`, anchored on the START day every time — never on the
 * previous instalment (design.md D3). A month that lacks `startDay`'s
 * day-of-month clamps to its own last day, but that clamp is never carried
 * forward: the month after is computed from the ORIGINAL day again (1/31 ->
 * 2/28 -> 3/31, not 1/31 -> 2/28 -> 3/28).
 *
 * Pure calendar arithmetic on UTC-midnight instants — `startDay` is already a
 * calendar date (`YYYY-MM-DD`), not an instant, so no timezone conversion
 * belongs here at all.
 */
export function addMonthsAnchored(startDay: string, months: number): string {
  const [year, month, day] = startDay.split("-").map(Number);
  const targetIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12; // 0-based
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(clampedDay)}`;
}
