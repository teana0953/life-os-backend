export interface BpReading {
  systolic: number;
  diastolic: number;
  /** Pulse the reading was taken with; null when not recorded. */
  pulse: number | null;
  /** Time-of-day the reading was taken, `HH:mm`; empty string for legacy data. */
  time: string;
}

/** When a glucose reading was taken relative to eating. */
export type GlucoseMealContext = "fasting" | "pre_meal" | "post_meal";

export interface GlucoseReading {
  /** Free-text label, e.g. "餐前"/"餐后" (empty string when none). */
  label: string;
  /** mg/dL. */
  value: number;
  /** Meal context of the reading (fasting / pre-meal / post-meal); null when none. */
  mealContext: GlucoseMealContext | null;
  /** Time-of-day the reading was taken, `HH:mm`; empty string for legacy data. */
  time: string;
}

export interface Spo2Reading {
  /** SpO₂ percentage. */
  spo2: number;
  /** Optional pulse; null when not recorded. */
  pulse: number | null;
  /** Time-of-day the reading was taken, `HH:mm`; empty string for legacy data. */
  time: string;
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
