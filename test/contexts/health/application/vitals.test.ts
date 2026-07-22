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
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70 }],
      glucoseReadings: [{ label: "餐前", value: 95 }],
      spo2Readings: [{ spo2: 98, pulse: 71 }],
    });

    const result = await getVitalsDay(repo, "user-1", "2026-07-18");

    expect(result).toEqual({
      day: "2026-07-18",
      weightKg: 65.5,
      bodyFatPct: 22.1,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70 }],
      glucoseReadings: [{ label: "餐前", value: 95 }],
      spo2Readings: [{ spo2: 98, pulse: 71 }],
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
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70 }],
      glucoseReadings: [{ label: "a", value: 90 }],
      spo2Readings: [{ spo2: 97, pulse: 60 }],
    });

    const record = await setVitalsDay(repo, {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: 65.5,
      bodyFatPct: 22.1,
      bpReadings: [
        { systolic: 120, diastolic: 80, pulse: 70 },
        { systolic: 118, diastolic: 78, pulse: 72 },
      ],
      glucoseReadings: [
        { label: "餐前", value: 95 },
        { label: "餐後", value: 110 },
      ],
      spo2Readings: [{ spo2: 98, pulse: null }],
    });

    expect(record.weightKg).toBe(65.5);
    expect(record.bpReadings).toHaveLength(2);
    expect(record.spo2Readings).toEqual([{ spo2: 98, pulse: null }]);
    expect(await repo.get("user-1", "2026-07-18")).toEqual({
      userId: "user-1",
      day: "2026-07-18",
      weightKg: 65.5,
      bodyFatPct: 22.1,
      bpReadings: [
        { systolic: 120, diastolic: 80, pulse: 70 },
        { systolic: 118, diastolic: 78, pulse: 72 },
      ],
      glucoseReadings: [
        { label: "餐前", value: 95 },
        { label: "餐後", value: 110 },
      ],
      spo2Readings: [{ spo2: 98, pulse: null }],
    });
  });
});
