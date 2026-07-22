import type { VitalsRecord } from "./vitals";

/** A single dated data point in a metric's time series. */
export interface Point {
  day: string;
  value: number;
}

/** Per-metric daily time series derived from a range of vitals records. */
export interface VitalsSeries {
  weight: Point[];
  bodyFat: Point[];
  systolic: Point[];
  diastolic: Point[];
  pulse: Point[];
  glucose: Point[];
  spo2: Point[];
}

/** Round to one decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Mean of the numbers, or null when the list is empty. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Derives per-metric daily time series from vitals records (assumed ascending by
 * day). Scalars (weight, body fat) become one point per recorded day to one
 * decimal; reading-based metrics become the day's mean rounded to a whole number;
 * a day with no value for a metric contributes no point.
 */
export function buildVitalsSeries(records: VitalsRecord[]): VitalsSeries {
  const series: VitalsSeries = {
    weight: [],
    bodyFat: [],
    systolic: [],
    diastolic: [],
    pulse: [],
    glucose: [],
    spo2: [],
  };

  for (const record of records) {
    const { day } = record;

    if (record.weightKg != null) series.weight.push({ day, value: round1(record.weightKg) });
    if (record.bodyFatPct != null) series.bodyFat.push({ day, value: round1(record.bodyFatPct) });

    const systolic = mean(record.bpReadings.map((r) => r.systolic));
    if (systolic != null) series.systolic.push({ day, value: Math.round(systolic) });

    const diastolic = mean(record.bpReadings.map((r) => r.diastolic));
    if (diastolic != null) series.diastolic.push({ day, value: Math.round(diastolic) });

    const pulses = [
      ...record.bpReadings.map((r) => r.pulse),
      ...record.spo2Readings.map((r) => r.pulse),
    ].filter((p): p is number => p != null);
    const pulse = mean(pulses);
    if (pulse != null) series.pulse.push({ day, value: Math.round(pulse) });

    const glucose = mean(record.glucoseReadings.map((r) => r.value));
    if (glucose != null) series.glucose.push({ day, value: Math.round(glucose) });

    const spo2 = mean(record.spo2Readings.map((r) => r.spo2));
    if (spo2 != null) series.spo2.push({ day, value: Math.round(spo2) });
  }

  return series;
}
