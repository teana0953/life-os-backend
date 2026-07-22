import { describe, expect, it } from "vitest";
import { DrizzleVitalsRepository } from "../../../../src/contexts/health/adapters/drizzle-vitals-repository";
import type { Db } from "../../../../src/shared/db/client";

/**
 * Legacy-tolerance coverage for the read coerce: a reading persisted before the
 * `time` field existed has no `time` key, and must read back with `time: ""`.
 * We can't exercise this through the in-memory fake repos (they store
 * already-typed records), so we drive `toDomain` directly via a fake db whose
 * select chain returns a stored row with no `time` on its readings.
 */
function fakeDbReturning(row: unknown): Db {
  const chain = { limit: () => [row] };
  return {
    select: () => ({ from: () => ({ where: () => chain }) }),
  } as unknown as Db;
}

describe("DrizzleVitalsRepository read coerce", () => {
  it("reads a legacy reading with no time back with time: ''", async () => {
    const storedRow = {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: null,
      bodyFatPct: null,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70 }],
      glucoseReadings: [{ label: "餐前", value: 95 }],
      spo2Readings: [{ spo2: 98, pulse: null }],
    };
    const repo = new DrizzleVitalsRepository(() => fakeDbReturning(storedRow));

    const result = await repo.get("user-1", "2026-07-18");

    expect(result?.bpReadings).toEqual([{ systolic: 120, diastolic: 80, pulse: 70, time: "" }]);
    expect(result?.glucoseReadings).toEqual([{ label: "餐前", value: 95, time: "" }]);
    expect(result?.spo2Readings).toEqual([{ spo2: 98, pulse: null, time: "" }]);
  });

  it("preserves an existing time on read", async () => {
    const storedRow = {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: null,
      bodyFatPct: null,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }],
      glucoseReadings: [],
      spo2Readings: [],
    };
    const repo = new DrizzleVitalsRepository(() => fakeDbReturning(storedRow));

    const result = await repo.get("user-1", "2026-07-18");

    expect(result?.bpReadings).toEqual([{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }]);
  });
});
