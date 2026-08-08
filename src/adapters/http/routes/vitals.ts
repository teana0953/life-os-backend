import type { Context } from "hono";
import { getVitalsDay } from "../../../contexts/health/application/get-vitals-day";
import { getVitalsRange } from "../../../contexts/health/application/get-vitals-range";
import { setVitalsDay } from "../../../contexts/health/application/set-vitals-day";
import type { BpReading, GlucoseMealContext, GlucoseReading, Spo2Reading, VitalsRecord } from "../../../contexts/health/domain/vitals";
import type { VitalsSeries } from "../../../contexts/health/domain/vitals-series";
import type { VitalsRepository } from "../../../contexts/health/domain/vitals-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay, requireNumberInRange, requireString } from "../validation";

export interface VitalsHandlerOptions {
  userRepository: UserRepository;
  vitalsRepository: VitalsRepository;
}

/** Serializes a vitals record to the snake_case JSON shape returned by both endpoints. */
function toJson(record: { day: string; weightKg: number | null; bodyFatPct: number | null; waistCm: number | null; bpReadings: BpReading[]; glucoseReadings: GlucoseReading[]; spo2Readings: Spo2Reading[] }) {
  return {
    day: record.day,
    weight_kg: record.weightKg,
    body_fat_pct: record.bodyFatPct,
    waist_cm: record.waistCm,
    bp_readings: record.bpReadings,
    glucose_readings: record.glucoseReadings.map((r) => ({
      label: r.label,
      value: r.value,
      meal_context: r.mealContext,
      time: r.time,
    })),
    spo2_readings: record.spo2Readings,
  };
}

/** Optional non-negative number or null: `null`/absent → null, else validated ≥ 0 (with an optional upper bound). */
function nullableNumber(value: unknown, field: string, min = 0, max?: number): number | null {
  return value == null ? null : requireNumberInRange(value, field, min, max);
}

const GLUCOSE_MEAL_CONTEXTS: readonly GlucoseMealContext[] = ["fasting", "pre_meal", "post_meal"];

/** Optional glucose meal context: `null`/absent → null; one of the three → itself; anything else → 400. */
function optionalMealContext(value: unknown, field: string): GlucoseMealContext | null {
  if (value == null) return null;
  if (typeof value === "string" && GLUCOSE_MEAL_CONTEXTS.includes(value as GlucoseMealContext)) {
    return value as GlucoseMealContext;
  }
  throw new BadRequestError(`${field} must be one of ${GLUCOSE_MEAL_CONTEXTS.join(", ")}`);
}

/** Validates an array field: absent → `[]`; a non-array → 400; each item mapped via `mapItem`. */
function requireReadingArray<T>(value: unknown, field: string, mapItem: (item: Record<string, unknown>, index: number) => T): T[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new BadRequestError(`${field} must be an array`);
  return value.map((item, index) => {
    if (item == null || typeof item !== "object") {
      throw new BadRequestError(`${field}[${index}] must be an object`);
    }
    return mapItem(item as Record<string, unknown>, index);
  });
}

/** Protected `GET /api/vitals?day=`: the day's scalars and three reading lists (defaults for an unrecorded day). */
export function createGetVitalsHandler(options: VitalsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const result = await getVitalsDay(options.vitalsRepository, userId, requireDay(c.req.query("day")));
    return c.json(toJson(result));
  };
}

/** Serializes the per-metric series to its snake_case JSON shape. */
function seriesToJson(series: VitalsSeries) {
  return {
    weight: series.weight,
    body_fat: series.bodyFat,
    waist: series.waist,
    systolic: series.systolic,
    diastolic: series.diastolic,
    pulse: series.pulse,
    glucose: series.glucose.map((p) => ({
      day: p.day,
      time: p.time,
      value: p.value,
      meal_context: p.mealContext,
    })),
    spo2: series.spo2,
  };
}

/** Protected `GET /api/vitals/range?from=&to=`: per-metric per-reading series over `[from, to]`. */
/** Max span (in days) the range endpoint will serve; the trend UI needs ≤ ~90. */
const MAX_RANGE_DAYS = 366;

/** Whole-day span between two ISO `YYYY-MM-DD` dates, via UTC (no DST drift). */
function daySpan(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000;
}

export function createGetVitalsRangeHandler(options: VitalsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const from = requireDay(c.req.query("from"), "from");
    const to = requireDay(c.req.query("to"), "to");
    if (from > to) throw new BadRequestError("from must not be later than to");
    // Bound the span so an over-wide range can't request an unbounded response
    // (the trend UI asks for at most ~90 days).
    if (daySpan(from, to) > MAX_RANGE_DAYS) {
      throw new BadRequestError(`range must not exceed ${MAX_RANGE_DAYS} days`);
    }
    const { series } = await getVitalsRange(options.vitalsRepository, userId, from, to);
    return c.json({ from, to, series: seriesToJson(series) });
  };
}

/** Protected `PUT /api/vitals`: upsert the whole day's record and return it. */
export function createSetVitalsHandler(options: VitalsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const record: VitalsRecord = await setVitalsDay(options.vitalsRepository, {
      userId,
      day: requireDay(body.day),
      // Percentages are capped at 100; every other measurement is non-negative.
      weightKg: nullableNumber(body.weight_kg, "weight_kg"),
      bodyFatPct: nullableNumber(body.body_fat_pct, "body_fat_pct", 0, 100),
      // 20..300 cm: wide enough for any real person, narrow enough that a
      // metre/centimetre mix-up (0.78) or a typo (780) is refused.
      waistCm: nullableNumber(body.waist_cm, "waist_cm", 20, 300),
      bpReadings: requireReadingArray(body.bp_readings, "bp_readings", (item, i) => ({
        systolic: requireNumberInRange(item.systolic, `bp_readings[${i}].systolic`, 0),
        diastolic: requireNumberInRange(item.diastolic, `bp_readings[${i}].diastolic`, 0),
        pulse: nullableNumber(item.pulse, `bp_readings[${i}].pulse`),
        time: requireString(item.time, `bp_readings[${i}].time`),
      })),
      glucoseReadings: requireReadingArray(body.glucose_readings, "glucose_readings", (item, i) => ({
        label: typeof item.label === "string" ? item.label : "",
        value: requireNumberInRange(item.value, `glucose_readings[${i}].value`, 0),
        mealContext: optionalMealContext(item.meal_context, `glucose_readings[${i}].meal_context`),
        time: requireString(item.time, `glucose_readings[${i}].time`),
      })),
      spo2Readings: requireReadingArray(body.spo2_readings, "spo2_readings", (item, i) => ({
        spo2: requireNumberInRange(item.spo2, `spo2_readings[${i}].spo2`, 0, 100),
        pulse: nullableNumber(item.pulse, `spo2_readings[${i}].pulse`),
        time: requireString(item.time, `spo2_readings[${i}].time`),
      })),
    });
    return c.json(toJson(record));
  };
}
