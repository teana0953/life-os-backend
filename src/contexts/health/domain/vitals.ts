export interface BpReading {
  systolic: number;
  diastolic: number;
  /** Pulse the reading was taken with; null when not recorded. */
  pulse: number | null;
}

export interface GlucoseReading {
  /** Free-text label, e.g. "餐前"/"餐后" (empty string when none). */
  label: string;
  /** mg/dL. */
  value: number;
}

export interface Spo2Reading {
  /** SpO₂ percentage. */
  spo2: number;
  /** Optional pulse; null when not recorded. */
  pulse: number | null;
}

export interface VitalsRecord {
  userId: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  day: string;
  /** Weight in kg; null when not measured. */
  weightKg: number | null;
  /** Body fat percentage; null when not measured. */
  bodyFatPct: number | null;
  bpReadings: BpReading[];
  glucoseReadings: GlucoseReading[];
  spo2Readings: Spo2Reading[];
}
