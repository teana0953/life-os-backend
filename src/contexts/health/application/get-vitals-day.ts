import type { BpReading, GlucoseReading, Spo2Reading } from "../domain/vitals";
import type { VitalsRepository } from "../domain/vitals-repository";

export interface VitalsDay {
  day: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  waistCm: number | null;
  bpReadings: BpReading[];
  glucoseReadings: GlucoseReading[];
  spo2Readings: Spo2Reading[];
}

/**
 * Use case: a day's vitals record. When the day has no record, reports the empty
 * default (null scalars, three empty lists) — mirroring bowel/water's "no record →
 * default" behaviour.
 */
export async function getVitalsDay(repository: VitalsRepository, userId: string, day: string): Promise<VitalsDay> {
  const record = await repository.get(userId, day);
  if (record) {
    return {
      day: record.day,
      weightKg: record.weightKg,
      bodyFatPct: record.bodyFatPct,
      waistCm: record.waistCm,
      bpReadings: record.bpReadings,
      glucoseReadings: record.glucoseReadings,
      spo2Readings: record.spo2Readings,
    };
  }
  return { day, weightKg: null, bodyFatPct: null, waistCm: null, bpReadings: [], glucoseReadings: [], spo2Readings: [] };
}
