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
  /** Upsert semantics, keyed by (userId, day), for all `rows` in one batched write. Empty input is a no-op. */
  setMany(rows: SetVitalsInput[]): Promise<void>;
  /** The most recent recorded (non-null) weight for the user, or null when none. */
  getLatestWeight(userId: string): Promise<number | null>;
  /** The earliest recorded (non-null) weight for the user, or null when none. */
  getEarliestWeight(userId: string): Promise<number | null>;
  /** The number of distinct days on which the user recorded a (non-null) weight. */
  getWeightDayCount(userId: string): Promise<number>;
  /** The user's records with day in `[from, to]` (inclusive), ascending by day. */
  listRange(userId: string, from: string, to: string): Promise<VitalsRecord[]>;
}
