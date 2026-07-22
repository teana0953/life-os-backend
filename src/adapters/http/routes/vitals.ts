import type { Context } from "hono";
import { getVitalsDay } from "../../../contexts/health/application/get-vitals-day";
import { setVitalsDay } from "../../../contexts/health/application/set-vitals-day";
import type { BpReading, GlucoseReading, Spo2Reading, VitalsRecord } from "../../../contexts/health/domain/vitals";
import type { VitalsRepository } from "../../../contexts/health/domain/vitals-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay, requireFiniteNumber } from "../validation";

export interface VitalsHandlerOptions {
  userRepository: UserRepository;
  vitalsRepository: VitalsRepository;
}

/** Serializes a vitals record to the snake_case JSON shape returned by both endpoints. */
function toJson(record: { day: string; weightKg: number | null; bodyFatPct: number | null; bpReadings: BpReading[]; glucoseReadings: GlucoseReading[]; spo2Readings: Spo2Reading[] }) {
  return {
    day: record.day,
    weight_kg: record.weightKg,
    body_fat_pct: record.bodyFatPct,
    bp_readings: record.bpReadings,
    glucose_readings: record.glucoseReadings,
    spo2_readings: record.spo2Readings,
  };
}

/** Optional finite number or null: `null`/absent → null, else validated. */
function nullableFiniteNumber(value: unknown, field: string): number | null {
  return value == null ? null : requireFiniteNumber(value, field);
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

/** Protected `PUT /api/vitals`: upsert the whole day's record and return it. */
export function createSetVitalsHandler(options: VitalsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const record: VitalsRecord = await setVitalsDay(options.vitalsRepository, {
      userId,
      day: requireDay(body.day),
      weightKg: nullableFiniteNumber(body.weight_kg, "weight_kg"),
      bodyFatPct: nullableFiniteNumber(body.body_fat_pct, "body_fat_pct"),
      bpReadings: requireReadingArray(body.bp_readings, "bp_readings", (item, i) => ({
        systolic: requireFiniteNumber(item.systolic, `bp_readings[${i}].systolic`),
        diastolic: requireFiniteNumber(item.diastolic, `bp_readings[${i}].diastolic`),
        pulse: nullableFiniteNumber(item.pulse, `bp_readings[${i}].pulse`),
      })),
      glucoseReadings: requireReadingArray(body.glucose_readings, "glucose_readings", (item, i) => ({
        label: typeof item.label === "string" ? item.label : "",
        value: requireFiniteNumber(item.value, `glucose_readings[${i}].value`),
      })),
      spo2Readings: requireReadingArray(body.spo2_readings, "spo2_readings", (item, i) => ({
        spo2: requireFiniteNumber(item.spo2, `spo2_readings[${i}].spo2`),
        pulse: nullableFiniteNumber(item.pulse, `spo2_readings[${i}].pulse`),
      })),
    });
    return c.json(toJson(record));
  };
}
