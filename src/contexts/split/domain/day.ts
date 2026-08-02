/**
 * Whether `value` is a real calendar date in `YYYY-MM-DD` form. Uses
 * component comparison rather than `Date.parse`, since `new Date(...)`
 * silently rolls invalid days over (e.g. `2026-02-30` -> Mar 2) instead of
 * rejecting them.
 */
export function isValidDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}
