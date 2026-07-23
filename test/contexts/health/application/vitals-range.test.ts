import { describe, expect, it } from "vitest";
import { getVitalsRange } from "../../../../src/contexts/health/application/get-vitals-range";
import type { VitalsRecord } from "../../../../src/contexts/health/domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../../../../src/contexts/health/domain/vitals-repository";

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

class FakeVitalsRepository implements VitalsRepository {
  constructor(private readonly records: VitalsRecord[]) {}
  async get(): Promise<VitalsRecord | null> {
    return null;
  }
  async set(_input: SetVitalsInput): Promise<VitalsRecord> {
    throw new Error("not used");
  }
  async getLatestWeight(): Promise<number | null> {
    return null;
  }
  async getEarliestWeight(): Promise<number | null> {
    return null;
  }
  async getWeightDayCount(userId: string): Promise<number> {
    return this.records.filter((r) => r.userId === userId && r.weightKg !== null).length;
  }
  async listRange(userId: string, from: string, to: string): Promise<VitalsRecord[]> {
    return this.records.filter((r) => r.userId === userId && r.day >= from && r.day <= to);
  }
}

describe("getVitalsRange", () => {
  it("returns from/to and the built series for the records in range", async () => {
    const repo = new FakeVitalsRepository([
      record({ day: "2026-07-01", weightKg: 52 }),
      record({ day: "2026-07-03", weightKg: 51.7 }),
    ]);

    const result = await getVitalsRange(repo, "user-1", "2026-07-01", "2026-07-31");

    expect(result.from).toBe("2026-07-01");
    expect(result.to).toBe("2026-07-31");
    expect(result.series.weight).toEqual([
      { day: "2026-07-01", value: 52 },
      { day: "2026-07-03", value: 51.7 },
    ]);
  });
});
