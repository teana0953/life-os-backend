import { beforeEach, describe, expect, it } from "vitest";
import { importChaodaysWeight } from "../../../../src/contexts/health/application/import-chaodays-weight";
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../../../src/contexts/health/domain/chaodays-client";
import type { ChaodaysClient, ChaodaysSession, ChaodaysWeightRecord } from "../../../../src/contexts/health/domain/chaodays-client";
import type { VitalsRecord } from "../../../../src/contexts/health/domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../../../../src/contexts/health/domain/vitals-repository";

class InMemoryVitalsRepository implements VitalsRepository {
  private byUserDay = new Map<string, VitalsRecord>();
  setManyCallCount = 0;

  /** Test helper: seed a whole record for a user/day. */
  seed(record: VitalsRecord) {
    this.byUserDay.set(`${record.userId}:${record.day}`, record);
  }

  async get(userId: string, day: string): Promise<VitalsRecord | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetVitalsInput): Promise<VitalsRecord> {
    const record: VitalsRecord = {
      userId: input.userId,
      day: input.day,
      weightKg: input.weightKg,
      bodyFatPct: input.bodyFatPct,
      waistCm: input.waistCm,
      bpReadings: input.bpReadings,
      glucoseReadings: input.glucoseReadings,
      spo2Readings: input.spo2Readings,
    };
    this.byUserDay.set(`${input.userId}:${input.day}`, record);
    return record;
  }

  async setMany(rows: SetVitalsInput[]): Promise<void> {
    this.setManyCallCount++;
    for (const row of rows) {
      await this.set(row);
    }
  }

  async getLatestWeight(): Promise<number | null> {
    throw new Error("not used in this test");
  }

  async getEarliestWeight(): Promise<number | null> {
    throw new Error("not used in this test");
  }

  async getWeightDayCount(): Promise<number> {
    throw new Error("not used in this test");
  }

  async listRange(userId: string, from: string, to: string): Promise<VitalsRecord[]> {
    return [...this.byUserDay.values()].filter((r) => r.userId === userId && r.day >= from && r.day <= to);
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

class FakeChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysWeightRecord[] = [];
  // Captured args, so tests can assert the use case threads them through.
  signInArgs: { uid: string; password: string } | null = null;
  fetchArgs: { from: string; to: string } | null = null;
  signInCallCount = 0;
  fetchCalls: { from: string; to: string }[] = [];
  /** When set, the fetch with this 1-based call number throws instead of returning. */
  failOnFetchCall: number | null = null;

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    this.signInArgs = { uid, password };
    this.signInCallCount++;
    if (this.signInError) throw this.signInError;
    return SESSION;
  }

  // Returns only the records inside `[from, to]`, like the real client — a fake
  // that ignored the range would hand every batch the same records.
  async fetchWeightRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWeightRecord[] }> {
    this.fetchArgs = { from, to };
    this.fetchCalls.push({ from, to });
    if (this.fetchCalls.length === this.failOnFetchCall) throw new ChaodaysUpstreamError("status_502");
    return { session, records: this.records.filter((r) => r.date >= from && r.date <= to) };
  }

  fetchDietRecords(): never {
    throw new Error("not used in this test");
  }

  fetchWaterRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDefecationRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDietMenus(): never {
    throw new Error("not used in this test");
  }

  fetchMenstruals(): never {
    throw new Error("not used in this test");
  }
}

/** The day after `day`, computed in UTC. */
function dayAfter(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Asserts `calls` are several contiguous, non-overlapping sub-ranges covering exactly `[from, to]`. */
function expectContiguousCover(calls: { from: string; to: string }[], from: string, to: string) {
  expect(calls.length).toBeGreaterThan(1);
  expect(calls[0].from).toBe(from);
  expect(calls[calls.length - 1].to).toBe(to);
  for (let i = 1; i < calls.length; i++) {
    expect(calls[i].from).toBe(dayAfter(calls[i - 1].to));
  }
}

let vitalsRepository: InMemoryVitalsRepository;
let chaodaysClient: FakeChaodaysClient;

beforeEach(() => {
  vitalsRepository = new InMemoryVitalsRepository();
  chaodaysClient = new FakeChaodaysClient();
});

describe("importChaodaysWeight", () => {
  it("writes weight and body fat for each record and reports the summary", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", weight: 65.5, bodyFatPct: 22.1 },
      { date: "2026-07-02", weight: 65.2, bodyFatPct: null },
    ];

    const summary = await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(summary).toEqual({ imported: 2, skipped: 0, from: "2026-07-01", to: "2026-07-02" });
    // The credentials and range thread through to the client unchanged.
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchArgs).toEqual({ from: "2026-07-01", to: "2026-07-02" });
    expect(await vitalsRepository.get("user-1", "2026-07-01")).toEqual({
      userId: "user-1",
      day: "2026-07-01",
      weightKg: 65.5,
      bodyFatPct: 22.1,
      waistCm: null,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });
    expect((await vitalsRepository.get("user-1", "2026-07-02"))?.bodyFatPct).toBeNull();
  });

  it("preserves existing bp/glucose/spo2 readings on the day (read-modify-write)", async () => {
    vitalsRepository.seed({
      userId: "user-1",
      day: "2026-07-01",
      weightKg: 60,
      bodyFatPct: 20,
      waistCm: null,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }],
      glucoseReadings: [{ label: "餐前", value: 95, mealContext: "pre_meal", time: "07:45" }],
      spo2Readings: [{ spo2: 98, pulse: 71, time: "08:30" }],
    });
    chaodaysClient.records = [{ date: "2026-07-01", weight: 65.5, bodyFatPct: 22.1 }];

    await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    const record = await vitalsRepository.get("user-1", "2026-07-01");
    expect(record?.weightKg).toBe(65.5);
    expect(record?.bodyFatPct).toBe(22.1);
    expect(record?.bpReadings).toEqual([{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }]);
    expect(record?.glucoseReadings).toEqual([{ label: "餐前", value: 95, mealContext: "pre_meal", time: "07:45" }]);
    expect(record?.spo2Readings).toEqual([{ spo2: 98, pulse: 71, time: "08:30" }]);
  });

  it("does not erase an existing body fat when the chaodays record has none", async () => {
    vitalsRepository.seed({
      userId: "user-1",
      day: "2026-07-01",
      weightKg: 60,
      bodyFatPct: 20,
      waistCm: null,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });
    chaodaysClient.records = [{ date: "2026-07-01", weight: 65.5, bodyFatPct: null }];

    await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    const record = await vitalsRepository.get("user-1", "2026-07-01");
    expect(record?.weightKg).toBe(65.5);
    expect(record?.bodyFatPct).toBe(20);
  });

  it("skips records with no weight and counts them", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", weight: 65.5, bodyFatPct: null },
      { date: "2026-07-02", weight: null, bodyFatPct: null },
    ];

    const summary = await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(summary).toEqual({ imported: 1, skipped: 1, from: "2026-07-01", to: "2026-07-02" });
    expect(await vitalsRepository.get("user-1", "2026-07-02")).toBeNull();
  });

  it("carries an earlier same-day record's body fat forward to a later record on the same day that has none", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", weight: 65.0, bodyFatPct: 22.5 },
      { date: "2026-07-01", weight: 65.5, bodyFatPct: null },
    ];

    const summary = await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary).toEqual({ imported: 2, skipped: 0, from: "2026-07-01", to: "2026-07-01" });
    const record = await vitalsRepository.get("user-1", "2026-07-01");
    // Final weight is the last record's; body fat is inherited from the earlier record.
    expect(record?.weightKg).toBe(65.5);
    expect(record?.bodyFatPct).toBe(22.5);
  });

  it("persists a multi-day range via one setMany call, not per-day", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", weight: 65.5, bodyFatPct: 22.1 },
      { date: "2026-07-02", weight: 65.2, bodyFatPct: null },
      { date: "2026-07-03", weight: 65.0, bodyFatPct: 21.9 },
    ];

    const summary = await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-03",
    });

    expect(summary).toEqual({ imported: 3, skipped: 0, from: "2026-07-01", to: "2026-07-03" });
    expect(vitalsRepository.setManyCallCount).toBe(1);
  });

  it("performs zero writes (no setMany calls) for an empty range", async () => {
    chaodaysClient.records = [];

    const summary = await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(summary).toEqual({ imported: 0, skipped: 0, from: "2026-07-01", to: "2026-07-02" });
    expect(vitalsRepository.setManyCallCount).toBe(0);
  });

  it("fetches a range longer than the batch size as several contiguous requests, signing in once", async () => {
    chaodaysClient.records = [
      { date: "2026-01-01", weight: 70, bodyFatPct: 20 },
      // Either side of the first 183-day boundary.
      { date: "2026-07-02", weight: 71, bodyFatPct: null },
      { date: "2026-07-03", weight: 72, bodyFatPct: null },
      { date: "2027-12-31", weight: 73, bodyFatPct: null },
    ];

    const summary = await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-01-01",
      to: "2027-12-31",
    });

    expectContiguousCover(chaodaysClient.fetchCalls, "2026-01-01", "2027-12-31");
    expect(chaodaysClient.signInCallCount).toBe(1);
    expect(summary).toEqual({ imported: 4, skipped: 0, from: "2026-01-01", to: "2027-12-31" });
    expect((await vitalsRepository.get("user-1", "2026-07-02"))?.weightKg).toBe(71);
    expect((await vitalsRepository.get("user-1", "2026-07-03"))?.weightKg).toBe(72);
  });

  it("writes nothing when a batch after the first fails", async () => {
    chaodaysClient.records = [
      // In the first batch, so a per-batch write would already have landed it.
      { date: "2026-01-01", weight: 70, bodyFatPct: 20 },
      { date: "2027-12-31", weight: 73, bodyFatPct: null },
    ];
    chaodaysClient.failOnFetchCall = 2;

    await expect(
      importChaodaysWeight(vitalsRepository, chaodaysClient, {
        userId: "user-1",
        uid: "chaodays-uid",
        password: "chaodays-pw",
        from: "2026-01-01",
        to: "2027-12-31",
      }),
    ).rejects.toThrow(ChaodaysUpstreamError);

    // The first batch did succeed, and no further batch was issued.
    expect(chaodaysClient.fetchCalls.length).toBe(2);
    // A failed import leaves the range untouched, so a retry is a clean retry.
    expect(vitalsRepository.setManyCallCount).toBe(0);
    expect(await vitalsRepository.listRange("user-1", "2026-01-01", "2027-12-31")).toEqual([]);
  });

  it("propagates a chaodays sign-in auth failure", async () => {
    chaodaysClient.signInError = new ChaodaysAuthError();

    await expect(
      importChaodaysWeight(vitalsRepository, chaodaysClient, {
        userId: "user-1",
        uid: "chaodays-uid",
        password: "wrong-password",
        from: "2026-07-01",
        to: "2026-07-02",
      }),
    ).rejects.toThrow(ChaodaysAuthError);
  });
});

describe("importChaodaysWeight leaves alone what chaodays does not have", () => {
  it("keeps a waist measurement the user recorded", async () => {
    // `set` is a whole-row upsert, so a field the importer forgets to carry
    // forward is a field it erases. chaodays has no waist figure at all,
    // which is exactly why nothing else here would have complained.
    vitalsRepository.seed({
      userId: "user-1",
      day: "2026-07-01",
      weightKg: 64,
      bodyFatPct: 21,
      waistCm: 78.5,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });
    chaodaysClient.records = [{ date: "2026-07-01", weight: 65.5, bodyFatPct: 22.1 }];

    await importChaodaysWeight(vitalsRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    const after = await vitalsRepository.get("user-1", "2026-07-01");
    expect(after?.waistCm).toBe(78.5);
    // And the import still did its own job.
    expect(after?.weightKg).toBe(65.5);
  });
});
