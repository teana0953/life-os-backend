/**
 * Minimal request-input validation for the HTTP adapter. Handlers call these to
 * reject malformed input with a `BadRequestError` (mapped to `400` by the app's
 * error handler) instead of coercing bad values into `NaN`/`"undefined"` and
 * persisting them or 500-ing downstream.
 */
export class BadRequestError extends Error {}

/** A non-empty string; throws otherwise. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(`${field} is required`);
  }
  return value;
}

/** A finite number (accepts numeric strings); throws on missing/NaN/Infinity. */
export function requireFiniteNumber(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (typeof value !== "number" && typeof value !== "string") {
    throw new BadRequestError(`${field} must be a number`);
  }
  if (!Number.isFinite(n)) {
    throw new BadRequestError(`${field} must be a number`);
  }
  return n;
}

/** Optional finite number: returns `fallback` when absent, else validates. */
export function optionalFiniteNumber(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  return requireFiniteNumber(value, field);
}

/** Optional finite number that stays `undefined` when absent (for optional overrides). */
export function optionalFiniteNumberOrUndefined(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireFiniteNumber(value, field);
}

/** Optional finite number greater than 0 that stays `undefined` when absent; throws when present but not finite or <= 0. */
export function optionalPositiveFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = requireFiniteNumber(value, field);
  if (n <= 0) throw new BadRequestError(`${field} must be greater than 0`);
  return n;
}

/** Optional timestamp (ISO string), returned as a `Date`; throws when present but not a valid timestamp. */
export function optionalTimestamp(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null) return undefined;
  return requireTimestamp(value, field);
}

/** A required timestamp (ISO string), returned as a `Date`; throws when missing or not a valid timestamp. */
export function requireTimestamp(value: unknown, field: string): Date {
  if (typeof value !== "string") throw new BadRequestError(`${field} must be a valid timestamp`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${field} must be a valid timestamp`);
  return date;
}

/**
 * An ISO calendar day `YYYY-MM-DD` that is also a real date; throws otherwise.
 * Uses component comparison rather than `Date.parse`, since V8 silently rolls
 * over invalid days (e.g. `2026-02-30` -> Mar 2) instead of rejecting them,
 * which would otherwise reach the Postgres `date` column and 500.
 */
export function requireDay(value: unknown, field = "day"): string {
  const s = requireString(value, field);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day) {
      return s;
    }
  }
  throw new BadRequestError(`${field} must be a valid date (YYYY-MM-DD)`);
}

/** A calendar month `YYYY-MM` (01-12); throws otherwise. */
export function requireMonth(value: unknown, field = "month"): string {
  const s = requireString(value, field);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) {
    throw new BadRequestError(`${field} must be a valid month (YYYY-MM)`);
  }
  return s;
}
