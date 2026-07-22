import type { MenstrualPeriod } from "./menstrual-period";

export interface MenstrualStats {
  averageCycleDays: number | null;
  averagePeriodDays: number | null;
  predictedNextStart: string | null;
}

/** The most recent number of cycle intervals averaged for the cycle length. */
const RECENT_INTERVALS = 6;

const MS_PER_DAY = 86_400_000;

/** Parses an ISO `YYYY-MM-DD` day to a UTC-midnight epoch (pure-date, DST-safe). */
function toUtcMillis(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

/** Inclusive whole-day difference between two ISO days (b - a). */
function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMillis(b) - toUtcMillis(a)) / MS_PER_DAY);
}

/** Adds whole days to an ISO day, returning a new ISO `YYYY-MM-DD`. */
function addDays(day: string, days: number): string {
  return new Date(toUtcMillis(day) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Derives cycle statistics from periods sorted ascending by startDate, without
 * persisting them. `averageCycleDays` is the mean gap between consecutive starts
 * over the most recent 6 intervals (needs >= 2 periods). `averagePeriodDays` is
 * the mean inclusive length (`end - start + 1`) of completed periods (needs >= 1
 * completed). `predictedNextStart` is the last start plus `averageCycleDays`.
 */
export function computeMenstrualStats(periods: MenstrualPeriod[]): MenstrualStats {
  const averageCycleDays = computeAverageCycleDays(periods);
  return {
    averageCycleDays,
    averagePeriodDays: computeAveragePeriodDays(periods),
    predictedNextStart:
      averageCycleDays === null || periods.length === 0
        ? null
        : addDays(periods[periods.length - 1].startDate, averageCycleDays),
  };
}

function computeAverageCycleDays(periods: MenstrualPeriod[]): number | null {
  if (periods.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < periods.length; i++) {
    gaps.push(daysBetween(periods[i - 1].startDate, periods[i].startDate));
  }
  const recent = gaps.slice(-RECENT_INTERVALS);
  const mean = recent.reduce((sum, gap) => sum + gap, 0) / recent.length;
  return Math.round(mean);
}

function computeAveragePeriodDays(periods: MenstrualPeriod[]): number | null {
  const lengths = periods
    .filter((p) => p.endDate !== null)
    .map((p) => daysBetween(p.startDate, p.endDate as string) + 1);
  if (lengths.length === 0) return null;
  const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  return Math.round(mean);
}
