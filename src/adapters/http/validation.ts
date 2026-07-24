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

/** Finite number that is at least `min` and (when given) at most `max`; throws 400 otherwise. */
export function requireNumberInRange(value: unknown, field: string, min: number, max?: number): number {
  const n = requireFiniteNumber(value, field);
  if (n < min) throw new BadRequestError(`${field} must be at least ${min}`);
  if (max !== undefined && n > max) throw new BadRequestError(`${field} must be at most ${max}`);
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

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A local time `HH:mm`; throws otherwise. */
export function requireHHMM(value: unknown, field: string): string {
  const s = requireString(value, field);
  if (!HH_MM.test(s)) throw new BadRequestError(`${field} must be HH:mm`);
  return s;
}

/** A non-empty string that parses as an `https://` URL; throws otherwise. */
export function requireHttpsUrl(value: unknown, field: string): string {
  const s = requireString(value, field);
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new BadRequestError(`${field} must be a valid https URL`);
  }
  if (url.protocol !== "https:") {
    throw new BadRequestError(`${field} must be a valid https URL`);
  }
  return s;
}

/** An array of strings; throws otherwise (empty arrays are allowed — callers enforce non-empty if needed). */
export function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new BadRequestError(`${field} must be an array of strings`);
  }
  return value;
}

/** An array of finite numbers; throws otherwise. */
export function requireNumberArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new BadRequestError(`${field} must be an array of numbers`);
  }
  return value;
}

/** An optional boolean: returns `fallback` when absent, else throws unless the value is a boolean. */
export function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new BadRequestError(`${field} must be a boolean`);
  return value;
}

/** Optional boolean that stays `undefined` when absent/null (for PATCH no-change semantics); throws otherwise unless the value is a boolean. */
export function optionalBooleanOrUndefined(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new BadRequestError(`${field} must be a boolean`);
  return value;
}

/** A calendar month `YYYY-MM` (01-12); throws otherwise. */
export function requireMonth(value: unknown, field = "month"): string {
  const s = requireString(value, field);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) {
    throw new BadRequestError(`${field} must be a valid month (YYYY-MM)`);
  }
  return s;
}
