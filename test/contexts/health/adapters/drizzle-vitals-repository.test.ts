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

/**
 * Captures what `set` hands to the driver. The write side had no coverage at
 * all: nulling both `waistCm` lines in the adapter left all 1219 tests green,
 * because every other test reaches vitals through an in-memory fake with its
 * own `set`. That failure would be this repo's most familiar one — every save
 * in production quietly writing the measurement away as null, with the suite
 * still green.
 */
function fakeDbCapturing(captured: { values?: Record<string, unknown> }): Db {
  const returning = () => [{ userId: "user-1", day: "2026-07-18", weightKg: null, bodyFatPct: null, waistCm: "78.5", bpReadings: [], glucoseReadings: [], spo2Readings: [] }];
  return {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured.values = values;
        return { onConflictDoUpdate: () => ({ returning }) };
      },
    }),
  } as unknown as Db;
}

describe("DrizzleVitalsRepository write coerce", () => {
  it("sends the waist as the string `numeric` wants, on both halves of the upsert", async () => {
    const captured: { values?: Record<string, unknown> } = {};
    const repo = new DrizzleVitalsRepository(() => fakeDbCapturing(captured));

    await repo.set({
      userId: "user-1",
      day: "2026-07-18",
      weightKg: 65.5,
      bodyFatPct: null,
      // Distinct from the weight beside it: equal values would let the two
      // columns be swapped without anything noticing.
      waistCm: 78.5,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });

    // A string, not a number — `numeric` takes strings, and this is the only
    // place the conversion happens. The same object is reused as the upsert's
    // `set`, so one assertion covers insert and update alike.
    expect(captured.values?.waistCm).toBe("78.5");
    expect(captured.values?.weightKg).toBe("65.5");
  });

  it("sends null for an unrecorded waist, not the string 'null'", async () => {
    const captured: { values?: Record<string, unknown> } = {};
    const repo = new DrizzleVitalsRepository(() => fakeDbCapturing(captured));

    await repo.set({
      userId: "user-1",
      day: "2026-07-18",
      weightKg: null,
      bodyFatPct: null,
      waistCm: null,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });

    expect(captured.values?.waistCm).toBeNull();
  });
});

describe("DrizzleVitalsRepository read coerce", () => {
  it("reads a legacy reading with no time back with time: ''", async () => {
    const storedRow = {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: null,
      bodyFatPct: null,
      // Stored as a string, because `numeric` comes back as one — the read
      // has to turn it into a number, and a fixture of `null` proves nothing
      // about that conversion or about which column it reads.
      waistCm: "78.5",
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70 }],
      glucoseReadings: [{ label: "餐前", value: 95 }],
      spo2Readings: [{ spo2: 98, pulse: null }],
    };
    const repo = new DrizzleVitalsRepository(() => fakeDbReturning(storedRow));

    const result = await repo.get("user-1", "2026-07-18");

    expect(result?.bpReadings).toEqual([{ systolic: 120, diastolic: 80, pulse: 70, time: "" }]);
    expect(result?.glucoseReadings).toEqual([{ label: "餐前", value: 95, mealContext: null, time: "" }]);
    expect(result?.spo2Readings).toEqual([{ spo2: 98, pulse: null, time: "" }]);
    expect(result?.waistCm).toBe(78.5);
  });

  it("preserves an existing time on read", async () => {
    const storedRow = {
      userId: "user-1",
      day: "2026-07-18",
      weightKg: null,
      bodyFatPct: null,
      waistCm: null,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }],
      glucoseReadings: [],
      spo2Readings: [],
    };
    const repo = new DrizzleVitalsRepository(() => fakeDbReturning(storedRow));

    const result = await repo.get("user-1", "2026-07-18");

    expect(result?.bpReadings).toEqual([{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }]);
  });
});
