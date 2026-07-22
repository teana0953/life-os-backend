import { describe, expect, it } from "vitest";
import { buildVitalsSeries } from "../../../../src/contexts/health/domain/vitals-series";
import type { VitalsRecord } from "../../../../src/contexts/health/domain/vitals";

function record(overrides: Partial<VitalsRecord> & { day: string }): VitalsRecord {
  return {
    userId: "user-1",
    weightKg: null,
    bodyFatPct: null,
    bpReadings: [],
    glucoseReadings: [],
    spo2Readings: [],
    ...overrides,
  };
}

describe("buildVitalsSeries", () => {
  it("emits one scalar point per recorded day and skips the null day", () => {
    const series = buildVitalsSeries([
      record({ day: "2026-07-01", weightKg: 52 }),
      record({ day: "2026-07-02" }),
      record({ day: "2026-07-03", weightKg: 51.7 }),
    ]);

    expect(series.weight).toEqual([
      { day: "2026-07-01", value: 52 },
      { day: "2026-07-03", value: 51.7 },
    ]);
  });

  it("emits body fat scalar to one decimal, skipping null days", () => {
    const series = buildVitalsSeries([
      record({ day: "2026-07-01", bodyFatPct: 22.15 }),
      record({ day: "2026-07-02" }),
    ]);

    expect(series.bodyFat).toEqual([{ day: "2026-07-01", value: 22.2 }]);
  });

  it("averages the day's blood-pressure readings for systolic and diastolic (rounded)", () => {
    const series = buildVitalsSeries([
      record({
        day: "2026-07-01",
        bpReadings: [
          { systolic: 118, diastolic: 76, pulse: null, time: "08:00" },
          { systolic: 122, diastolic: 80, pulse: null, time: "20:00" },
        ],
      }),
    ]);

    expect(series.systolic).toEqual([{ day: "2026-07-01", value: 120 }]);
    expect(series.diastolic).toEqual([{ day: "2026-07-01", value: 78 }]);
  });

  it("combines blood-pressure and blood-oxygen pulses into one daily mean", () => {
    const series = buildVitalsSeries([
      record({
        day: "2026-07-01",
        bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:00" }],
        spo2Readings: [{ spo2: 98, pulse: 74, time: "08:00" }],
      }),
    ]);

    expect(series.pulse).toEqual([{ day: "2026-07-01", value: 72 }]);
  });

  it("skips a metric on days with no data and produces an empty series when never recorded", () => {
    const series = buildVitalsSeries([
      record({ day: "2026-07-01", weightKg: 52 }),
    ]);

    expect(series.glucose).toEqual([]);
    expect(series.spo2).toEqual([]);
    expect(series.pulse).toEqual([]);
    expect(series.systolic).toEqual([]);
  });

  it("averages glucose and spo2 readings, rounded to whole numbers", () => {
    const series = buildVitalsSeries([
      record({
        day: "2026-07-01",
        glucoseReadings: [
          { label: "餐前", value: 95, time: "07:45" },
          { label: "餐後", value: 110, time: "12:30" },
        ],
        spo2Readings: [
          { spo2: 97, pulse: null, time: "08:00" },
          { spo2: 98, pulse: null, time: "20:00" },
        ],
      }),
    ]);

    expect(series.glucose).toEqual([{ day: "2026-07-01", value: 103 }]);
    expect(series.spo2).toEqual([{ day: "2026-07-01", value: 98 }]);
  });

  it("ignores null pulses when both reading lists lack any pulse", () => {
    const series = buildVitalsSeries([
      record({
        day: "2026-07-01",
        bpReadings: [{ systolic: 120, diastolic: 80, pulse: null, time: "08:00" }],
        spo2Readings: [{ spo2: 98, pulse: null, time: "08:00" }],
      }),
    ]);

    expect(series.pulse).toEqual([]);
  });
});
