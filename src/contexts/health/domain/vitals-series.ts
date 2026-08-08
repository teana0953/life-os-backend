import type { GlucoseMealContext, VitalsRecord } from "./vitals";

/** A single data point in a metric's time series: a day, the time-of-day the
 * reading was taken (`HH:mm`, "" for scalar/legacy points), and the value. */
export interface Point {
  day: string;
  time: string;
  value: number;
}

/** A glucose point additionally carries the reading's meal context. */
export interface GlucosePoint extends Point {
  mealContext: GlucoseMealContext | null;
}

/** Per-metric time series derived from a range of vitals records. Reading-based
 * metrics carry one point per reading (so every reading is plotted, not a daily
 * mean); scalar metrics (weight, body fat) carry one point per recorded day. */
export interface VitalsSeries {
  weight: Point[];
  bodyFat: Point[];
  waist: Point[];
  systolic: Point[];
  diastolic: Point[];
  pulse: Point[];
  glucose: GlucosePoint[];
  spo2: Point[];
}

/** Round to one decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Chronological order by day then time-of-day. */
function byDayThenTime(a: Point, b: Point): number {
  return a.day === b.day ? a.time.localeCompare(b.time) : a.day.localeCompare(b.day);
}

/**
 * Derives per-metric time series from vitals records. Scalars (weight, body fat)
 * become one point per recorded day to one decimal. Reading-based metrics become
 * one point per reading at the reading's time-of-day (pulse from every recorded
 * pulse across blood-pressure and blood-oxygen readings; glucose points carry
 * their meal context). Each series is ordered by day then time.
 */
export function buildVitalsSeries(records: VitalsRecord[]): VitalsSeries {
  const series: VitalsSeries = {
    weight: [],
    bodyFat: [],
    waist: [],
    systolic: [],
    diastolic: [],
    pulse: [],
    glucose: [],
    spo2: [],
  };

  for (const record of records) {
    const { day } = record;

    if (record.weightKg != null) series.weight.push({ day, time: "", value: round1(record.weightKg) });
    if (record.bodyFatPct != null) series.bodyFat.push({ day, time: "", value: round1(record.bodyFatPct) });
    if (record.waistCm != null) series.waist.push({ day, time: "", value: round1(record.waistCm) });

    for (const r of record.bpReadings) {
      series.systolic.push({ day, time: r.time, value: Math.round(r.systolic) });
      series.diastolic.push({ day, time: r.time, value: Math.round(r.diastolic) });
      if (r.pulse != null) series.pulse.push({ day, time: r.time, value: Math.round(r.pulse) });
    }

    for (const r of record.spo2Readings) {
      series.spo2.push({ day, time: r.time, value: Math.round(r.spo2) });
      if (r.pulse != null) series.pulse.push({ day, time: r.time, value: Math.round(r.pulse) });
    }

    for (const r of record.glucoseReadings) {
      series.glucose.push({ day, time: r.time, value: Math.round(r.value), mealContext: r.mealContext });
    }
  }

  series.weight.sort(byDayThenTime);
  series.bodyFat.sort(byDayThenTime);
  series.waist.sort(byDayThenTime);
  series.systolic.sort(byDayThenTime);
  series.diastolic.sort(byDayThenTime);
  series.pulse.sort(byDayThenTime);
  series.glucose.sort(byDayThenTime);
  series.spo2.sort(byDayThenTime);

  return series;
}
