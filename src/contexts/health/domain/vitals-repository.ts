import type { BpReading, GlucoseReading, Spo2Reading, VitalsRecord } from "./vitals";

export interface SetVitalsInput {
  userId: string;
  day: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  bpReadings: BpReading[];
  glucoseReadings: GlucoseReading[];
  spo2Readings: Spo2Reading[];
}

export interface VitalsRepository {
  get(userId: string, day: string): Promise<VitalsRecord | null>;
  /** Upsert semantics, keyed by (userId, day). */
  set(input: SetVitalsInput): Promise<VitalsRecord>;
}
