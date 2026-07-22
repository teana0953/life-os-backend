import { beforeEach, describe, expect, it } from "vitest";
import { getVitalsDay } from "../../../../src/contexts/health/application/get-vitals-day";
import { setVitalsDay } from "../../../../src/contexts/health/application/set-vitals-day";
import type { VitalsRecord } from "../../../../src/contexts/health/domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../../../../src/contexts/health/domain/vitals-repository";

class InMemoryVitalsRepository implements VitalsRepository {
  private byUserDay = new Map<string, VitalsRecord>();

  async get(userId: string, day: string): Promise<VitalsRecord | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetVitalsInput): Promise<VitalsRecord> {
    const record: VitalsRecord = {
      userId: input.userId,
      day: input.day,
      weightKg: input.weightKg,
      bodyFatPct: input.bodyFatPct,
      bpReadings: input.bpReadings,
      glucoseReadings: input.glucoseReadings,
      spo2Readings: input.spo2Readings,
    };
    this.byUserDay.set(`${input.userId}:${input.day}`, record);
    return record;
  }

  async getLatestWeight(userId: string): Promise<number | null> {
    return this.weightAtExtreme(userId, "latest");
  }

  async getEarliestWeight(userId: string): Promise<number | null> {
    return this.weightAtExtreme(userId, "earliest");
  }

  private weightAtExtreme(userId: string, which: "latest" | "earliest"): number | null {
    const withWeight = [...this.byUserDay.values()].filter((r) => r.userId === userId && r.weightKg !== null);
    if (withWeight.length === 0) return null;
    withWeight.sort((a, b) => a.day.localeCompare(b.day));
    const record = which === "latest" ? withWeight[withWeight.length - 1] : withWeight[0];
    return record.weightKg;
  }

  async listRange(userId: string, from: string, to: string): Promise<VitalsRecord[]> {
    return [...this.byUserDay.values()]
      .filter((r) => r.userId === userId && r.day >= from && r.day <= to)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
}

let repo: InMemoryVitalsRepository;

beforeEach(() => {
  repo = new InMemoryVitalsRepository();
});

describe("getVitalsDay", () => {
  it("returns the day's record mapped to a DTO when one exists", async () => {
    await setVitalsDay(repo, {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: 65.5,
      bodyFatPct: 22.1,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }],
      glucoseReadings: [{ label: "餐前", value: 95, time: "07:45" }],
      spo2Readings: [{ spo2: 98, pulse: 71, time: "08:30" }],
    });

    const result = await getVitalsDay(repo, "user-1", "2026-07-18");

    expect(result).toEqual({
      day: "2026-07-18",
      weightKg: 65.5,
      bodyFatPct: 22.1,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }],
      glucoseReadings: [{ label: "餐前", value: 95, time: "07:45" }],
      spo2Readings: [{ spo2: 98, pulse: 71, time: "08:30" }],
    });
  });

  it("returns an empty default when the day has no record", async () => {
    const result = await getVitalsDay(repo, "user-1", "2026-07-18");

    expect(result).toEqual({
      day: "2026-07-18",
      weightKg: null,
      bodyFatPct: null,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });
  });
});

describe("setVitalsDay", () => {
  it("upserts null scalars and empty arrays", async () => {
    const record = await setVitalsDay(repo, {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: null,
      bodyFatPct: null,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });

    expect(record).toEqual({
      userId: "user-1",
      day: "2026-07-18",
      weightKg: null,
      bodyFatPct: null,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });
  });

  it("upserts scalars and multiple readings in each list, including a null pulse", async () => {
    await setVitalsDay(repo, {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: 60,
      bodyFatPct: 20,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }],
      glucoseReadings: [{ label: "a", value: 90, time: "07:45" }],
      spo2Readings: [{ spo2: 97, pulse: 60, time: "08:30" }],
    });

    const record = await setVitalsDay(repo, {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: 65.5,
      bodyFatPct: 22.1,
      bpReadings: [
        { systolic: 120, diastolic: 80, pulse: 70, time: "08:30" },
        { systolic: 118, diastolic: 78, pulse: 72, time: "21:00" },
      ],
      glucoseReadings: [
        { label: "餐前", value: 95, time: "07:45" },
        { label: "餐後", value: 110, time: "12:30" },
      ],
      spo2Readings: [{ spo2: 98, pulse: null, time: "08:30" }],
    });

    expect(record.weightKg).toBe(65.5);
    expect(record.bpReadings).toHaveLength(2);
    expect(record.spo2Readings).toEqual([{ spo2: 98, pulse: null, time: "08:30" }]);
    expect(await repo.get("user-1", "2026-07-18")).toEqual({
      userId: "user-1",
      day: "2026-07-18",
      weightKg: 65.5,
      bodyFatPct: 22.1,
      bpReadings: [
        { systolic: 120, diastolic: 80, pulse: 70, time: "08:30" },
        { systolic: 118, diastolic: 78, pulse: 72, time: "21:00" },
      ],
      glucoseReadings: [
        { label: "餐前", value: 95, time: "07:45" },
        { label: "餐後", value: 110, time: "12:30" },
      ],
      spo2Readings: [{ spo2: 98, pulse: null, time: "08:30" }],
    });
  });
});
