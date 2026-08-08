import { describe, expect, it } from "vitest";
import { buildVitalsSeries } from "../../../../src/contexts/health/domain/vitals-series";
import type { VitalsRecord } from "../../../../src/contexts/health/domain/vitals";

function record(overrides: Partial<VitalsRecord> & { day: string }): VitalsRecord {
  return {
    userId: "user-1",
    weightKg: null,
    bodyFatPct: null,
    waistCm: null,
    bpReadings: [],
    glucoseReadings: [],
    spo2Readings: [],
    ...overrides,
  };
}

describe("buildVitalsSeries", () => {
  it("emits one scalar point per recorded day (time '') and skips the null day", () => {
    const series = buildVitalsSeries([
      record({ day: "2026-07-01", weightKg: 52 }),
      record({ day: "2026-07-02" }),
      record({ day: "2026-07-03", weightKg: 51.7 }),
    ]);

    expect(series.weight).toEqual([
      { day: "2026-07-01", time: "", value: 52 },
      { day: "2026-07-03", time: "", value: 51.7 },
    ]);
  });

  it("emits body fat scalar to one decimal, skipping null days", () => {
    const series = buildVitalsSeries([
      record({ day: "2026-07-01", bodyFatPct: 22.15 }),
      record({ day: "2026-07-02" }),
    ]);

    expect(series.bodyFat).toEqual([{ day: "2026-07-01", time: "", value: 22.2 }]);
  });

  it("emits waist scalar to one decimal, skipping null days", () => {
    const series = buildVitalsSeries([
      record({ day: "2026-07-01", waistCm: 78.55 }),
      record({ day: "2026-07-02" }),
    ]);

    expect(series.waist).toEqual([{ day: "2026-07-01", time: "", value: 78.6 }]);
  });

  it("emits one point per blood-pressure reading (no averaging), ordered by time", () => {
    const series = buildVitalsSeries([
      record({
        day: "2026-07-01",
        bpReadings: [
          { systolic: 122, diastolic: 80, pulse: null, time: "20:00" },
          { systolic: 118, diastolic: 76, pulse: null, time: "08:00" },
        ],
      }),
    ]);

    // Both readings appear as their own points, sorted by time-of-day.
    expect(series.systolic).toEqual([
      { day: "2026-07-01", time: "08:00", value: 118 },
      { day: "2026-07-01", time: "20:00", value: 122 },
    ]);
    expect(series.diastolic).toEqual([
      { day: "2026-07-01", time: "08:00", value: 76 },
      { day: "2026-07-01", time: "20:00", value: 80 },
    ]);
  });

  it("emits one pulse point per reading across blood-pressure and blood-oxygen", () => {
    const series = buildVitalsSeries([
      record({
        day: "2026-07-01",
        bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:00" }],
        spo2Readings: [{ spo2: 98, pulse: 74, time: "20:00" }],
      }),
    ]);

    expect(series.pulse).toEqual([
      { day: "2026-07-01", time: "08:00", value: 70 },
      { day: "2026-07-01", time: "20:00", value: 74 },
    ]);
  });

  it("skips a metric on days with no data and produces an empty series when never recorded", () => {
    const series = buildVitalsSeries([
      record({ day: "2026-07-01", weightKg: 52 }),
    ]);

    expect(series.glucose).toEqual([]);
    expect(series.spo2).toEqual([]);
    expect(series.pulse).toEqual([]);
    expect(series.systolic).toEqual([]);
    expect(series.waist).toEqual([]);
  });

  it("emits one spo2 point per reading, rounded to whole numbers", () => {
    const series = buildVitalsSeries([
      record({
        day: "2026-07-01",
        spo2Readings: [
          { spo2: 97, pulse: null, time: "08:00" },
          { spo2: 98, pulse: null, time: "20:00" },
        ],
      }),
    ]);

    expect(series.spo2).toEqual([
      { day: "2026-07-01", time: "08:00", value: 97 },
      { day: "2026-07-01", time: "20:00", value: 98 },
    ]);
  });

  it("emits one glucose point per reading, each carrying its meal context", () => {
    const series = buildVitalsSeries([
      record({
        day: "2026-07-01",
        glucoseReadings: [
          { label: "", value: 130, mealContext: "post_meal", time: "13:00" },
          { label: "", value: 95, mealContext: "fasting", time: "07:00" },
          { label: "", value: 110, mealContext: null, time: "18:00" },
        ],
      }),
    ]);

    // Every reading is its own point (no daily mean), ordered by time, with context.
    expect(series.glucose).toEqual([
      { day: "2026-07-01", time: "07:00", value: 95, mealContext: "fasting" },
      { day: "2026-07-01", time: "13:00", value: 130, mealContext: "post_meal" },
      { day: "2026-07-01", time: "18:00", value: 110, mealContext: null },
    ]);
  });

  it("orders points across days chronologically", () => {
    const series = buildVitalsSeries([
      record({ day: "2026-07-03", spo2Readings: [{ spo2: 96, pulse: null, time: "09:00" }] }),
      record({ day: "2026-07-01", spo2Readings: [{ spo2: 98, pulse: null, time: "21:00" }] }),
    ]);

    expect(series.spo2).toEqual([
      { day: "2026-07-01", time: "21:00", value: 98 },
      { day: "2026-07-03", time: "09:00", value: 96 },
    ]);
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
