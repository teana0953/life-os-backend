import { describe, expect, it } from "vitest";
import { computeMenstrualStats } from "../../../../src/contexts/health/domain/menstrual-stats";
import type { MenstrualPeriod } from "../../../../src/contexts/health/domain/menstrual-period";

function period(startDate: string, endDate: string | null = null): MenstrualPeriod {
  return { id: `p-${startDate}`, userId: "user-1", startDate, endDate };
}

describe("computeMenstrualStats", () => {
  it("averages the gaps between consecutive starts and predicts the next (worked example)", () => {
    const stats = computeMenstrualStats([period("2026-05-01"), period("2026-05-29"), period("2026-06-26")]);
    expect(stats.averageCycleDays).toBe(28);
    expect(stats.predictedNextStart).toBe("2026-07-24");
  });

  it("averages completed periods only for averagePeriodDays (inclusive end - start + 1)", () => {
    const stats = computeMenstrualStats([period("2026-05-01", "2026-05-05"), period("2026-05-29")]);
    expect(stats.averagePeriodDays).toBe(5);
  });

  it("is all null with a single open period", () => {
    const stats = computeMenstrualStats([period("2026-05-01")]);
    expect(stats).toEqual({ averageCycleDays: null, averagePeriodDays: null, predictedNextStart: null });
  });

  it("is all null with no periods", () => {
    expect(computeMenstrualStats([])).toEqual({ averageCycleDays: null, averagePeriodDays: null, predictedNextStart: null });
  });

  it("rounds the average cycle length to an integer", () => {
    // gaps: 28 and 29 -> mean 28.5 -> rounds to 29
    const stats = computeMenstrualStats([period("2026-05-01"), period("2026-05-29"), period("2026-06-27")]);
    expect(stats.averageCycleDays).toBe(29);
  });

  it("uses only the most recent N=6 intervals for the cycle average", () => {
    // A large leading gap (365 days) that must be excluded, then seven 28-day
    // (4-week) gaps. Only the most recent 6 gaps count -> all 28 -> average 28.
    // (Including the 365-day gap over all 8 gaps would give ~70.)
    const starts = [
      "2025-01-01",
      "2026-01-01",
      "2026-01-29",
      "2026-02-26",
      "2026-03-26",
      "2026-04-23",
      "2026-05-21",
      "2026-06-18",
      "2026-07-16",
    ];
    const stats = computeMenstrualStats(starts.map((s) => period(s)));
    expect(stats.averageCycleDays).toBe(28);
  });

  it("computes averagePeriodDays over multiple completed periods and ignores open ones", () => {
    const stats = computeMenstrualStats([
      period("2026-05-01", "2026-05-05"), // 5 days
      period("2026-05-29", "2026-06-01"), // 4 days
      period("2026-06-26"), // open, ignored
    ]);
    expect(stats.averagePeriodDays).toBe(5); // (5 + 4) / 2 = 4.5 -> rounds to 5 (round-half-up)
  });
});
