import { beforeEach, describe, expect, it } from "vitest";
import { importChaodaysWater } from "../../../../src/contexts/health/application/import-chaodays-water";
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../../../src/contexts/health/domain/chaodays-client";
import type { ChaodaysClient, ChaodaysSession, ChaodaysWaterRecord } from "../../../../src/contexts/health/domain/chaodays-client";
import type { WaterIntake, WaterTarget } from "../../../../src/contexts/health/domain/water";
import type { SetWaterTargetInput, WaterRepository } from "../../../../src/contexts/health/domain/water-repository";

class InMemoryWaterRepository implements WaterRepository {
  private intakeByUserDay = new Map<string, WaterIntake>();
  addIntakeManyCallCount = 0;

  async getIntake(userId: string, day: string): Promise<WaterIntake | null> {
    return this.intakeByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async addIntake(userId: string, day: string, addMl: number): Promise<WaterIntake> {
    const current = this.intakeByUserDay.get(`${userId}:${day}`);
    const totalMl = Math.max(0, (current?.totalMl ?? 0) + addMl);
    const intake: WaterIntake = { userId, day, totalMl };
    this.intakeByUserDay.set(`${userId}:${day}`, intake);
    return intake;
  }

  async addIntakeMany(rows: { userId: string; day: string; addMl: number }[]): Promise<void> {
    this.addIntakeManyCallCount++;
    for (const row of rows) {
      await this.addIntake(row.userId, row.day, row.addMl);
    }
  }

  async listIntakeRange(userId: string, from: string, to: string): Promise<WaterIntake[]> {
    return [...this.intakeByUserDay.values()].filter((r) => r.userId === userId && r.day >= from && r.day <= to);
  }

  async getTarget(): Promise<WaterTarget | null> {
    throw new Error("not used in this test");
  }

  async getLatestTargetOnOrBefore(): Promise<WaterTarget | null> {
    throw new Error("not used in this test");
  }

  async listTargetRange(): Promise<WaterTarget[]> {
    throw new Error("not used in this test");
  }

  async setTarget(_input: SetWaterTargetInput): Promise<WaterTarget> {
    throw new Error("not used in this test");
  }

  async setTargetMany(_rows: SetWaterTargetInput[]): Promise<void> {
    throw new Error("not used in this test");
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

class FakeChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysWaterRecord[] = [];
  signInArgs: { uid: string; password: string } | null = null;
  fetchArgs: { from: string; to: string } | null = null;
  signInCallCount = 0;
  fetchCalls: { from: string; to: string }[] = [];
  /**
   * How the fake spreads its records over the fetches:
   * - "range": each call returns only the records inside `[from, to]`, like the
   *   real client. Returning every record on every call instead would multiply
   *   each day's sum by the number of batches.
   * - "all-at-once": the first call returns every record and later calls return
   *   none — what a single request for the whole range looks like.
   */
  delivery: "range" | "all-at-once" = "range";
  /** When set, the fetch with this 1-based call number throws instead of returning. */
  failOnFetchCall: number | null = null;

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    this.signInArgs = { uid, password };
    this.signInCallCount++;
    if (this.signInError) throw this.signInError;
    return SESSION;
  }

  fetchWeightRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDietRecords(): never {
    throw new Error("not used in this test");
  }

  async fetchWaterRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWaterRecord[] }> {
    this.fetchArgs = { from, to };
    this.fetchCalls.push({ from, to });
    if (this.fetchCalls.length === this.failOnFetchCall) throw new ChaodaysUpstreamError("status_502");
    if (this.delivery === "all-at-once") {
      return { session, records: this.fetchCalls.length === 1 ? this.records : [] };
    }
    return { session, records: this.records.filter((r) => r.date >= from && r.date <= to) };
  }

  fetchDefecationRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDietMenus(): never {
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

let waterRepository: InMemoryWaterRepository;
let chaodaysClient: FakeChaodaysClient;

beforeEach(() => {
  waterRepository = new InMemoryWaterRepository();
  chaodaysClient = new FakeChaodaysClient();
});

describe("importChaodaysWater", () => {
  it("sums a day's entries and imports them", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", waterMl: 250, recordedAt: "2026-07-01 09:00" },
      { date: "2026-07-01", waterMl: 500, recordedAt: "2026-07-01 14:00" },
    ];

    const summary = await importChaodaysWater(waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary).toEqual({ imported: 1, skipped: 0, from: "2026-07-01", to: "2026-07-01" });
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchArgs).toEqual({ from: "2026-07-01", to: "2026-07-01" });
    expect(await waterRepository.getIntake("user-1", "2026-07-01")).toEqual({
      userId: "user-1",
      day: "2026-07-01",
      totalMl: 750,
    });
  });

  it("skips a day that already has lifeos intake, without clobbering it", async () => {
    await waterRepository.addIntake("user-1", "2026-07-01", 1000);
    chaodaysClient.records = [{ date: "2026-07-01", waterMl: 250, recordedAt: "2026-07-01 09:00" }];

    const summary = await importChaodaysWater(waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary).toEqual({ imported: 0, skipped: 1, from: "2026-07-01", to: "2026-07-01" });
    expect(await waterRepository.getIntake("user-1", "2026-07-01")).toEqual({
      userId: "user-1",
      day: "2026-07-01",
      totalMl: 1000,
    });
  });

  it("does not write a day whose entries sum to zero, and does not count it", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", waterMl: 0, recordedAt: "2026-07-01 09:00" },
      { date: "2026-07-01", waterMl: -100, recordedAt: "2026-07-01 10:00" },
      { date: "2026-07-01", waterMl: 100, recordedAt: "2026-07-01 11:00" },
    ];

    const summary = await importChaodaysWater(waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary).toEqual({ imported: 0, skipped: 0, from: "2026-07-01", to: "2026-07-01" });
    expect(await waterRepository.getIntake("user-1", "2026-07-01")).toBeNull();
  });

  it("reports zero imported and zero skipped for an empty range", async () => {
    chaodaysClient.records = [];

    const summary = await importChaodaysWater(waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(summary).toEqual({ imported: 0, skipped: 0, from: "2026-07-01", to: "2026-07-02" });
    expect(waterRepository.addIntakeManyCallCount).toBe(0);
  });

  it("handles multiple days independently, persisted via one addIntakeMany call", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", waterMl: 250, recordedAt: "2026-07-01 09:00" },
      { date: "2026-07-02", waterMl: 300, recordedAt: "2026-07-02 09:00" },
    ];

    const summary = await importChaodaysWater(waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(summary).toEqual({ imported: 2, skipped: 0, from: "2026-07-01", to: "2026-07-02" });
    expect((await waterRepository.getIntake("user-1", "2026-07-01"))?.totalMl).toBe(250);
    expect((await waterRepository.getIntake("user-1", "2026-07-02"))?.totalMl).toBe(300);
    // Regardless of the number of days, persistence is one batched call.
    expect(waterRepository.addIntakeManyCallCount).toBe(1);
  });

  it("fetches a range longer than the batch size as several contiguous requests, signing in once", async () => {
    chaodaysClient.records = [
      { date: "2026-01-01", waterMl: 250, recordedAt: "2026-01-01 09:00" },
      { date: "2027-12-31", waterMl: 300, recordedAt: "2027-12-31 09:00" },
    ];

    const summary = await importChaodaysWater(waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-01-01",
      to: "2027-12-31",
    });

    expectContiguousCover(chaodaysClient.fetchCalls, "2026-01-01", "2027-12-31");
    expect(chaodaysClient.signInCallCount).toBe(1);
    expect(summary).toEqual({ imported: 2, skipped: 0, from: "2026-01-01", to: "2027-12-31" });
  });

  it("writes the same intake and summary whether the range arrived in one response or several batches", async () => {
    // Days on both sides of the first 183-day boundary (2026-07-02 / 2026-07-03),
    // each with several entries, so a batch counted twice or a day dropped at the
    // seam shows up as a wrong daily sum.
    const records: ChaodaysWaterRecord[] = [
      { date: "2026-01-01", waterMl: 250, recordedAt: "2026-01-01 09:00" },
      { date: "2026-01-01", waterMl: 500, recordedAt: "2026-01-01 14:00" },
      { date: "2026-07-02", waterMl: 100, recordedAt: "2026-07-02 09:00" },
      { date: "2026-07-03", waterMl: 200, recordedAt: "2026-07-03 09:00" },
      { date: "2026-07-03", waterMl: 300, recordedAt: "2026-07-03 20:00" },
      { date: "2027-12-31", waterMl: 400, recordedAt: "2027-12-31 09:00" },
    ];
    const input = {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-01-01",
      to: "2027-12-31",
    };

    const singleRequestRepository = new InMemoryWaterRepository();
    const singleRequestClient = new FakeChaodaysClient();
    singleRequestClient.records = records;
    singleRequestClient.delivery = "all-at-once";
    const singleRequestSummary = await importChaodaysWater(singleRequestRepository, singleRequestClient, input);

    chaodaysClient.records = records;
    const batchedSummary = await importChaodaysWater(waterRepository, chaodaysClient, input);

    expect(chaodaysClient.fetchCalls.length).toBeGreaterThan(1);
    expect(batchedSummary).toEqual(singleRequestSummary);
    expect(await waterRepository.listIntakeRange("user-1", input.from, input.to)).toEqual(
      await singleRequestRepository.listIntakeRange("user-1", input.from, input.to),
    );
    // Pinned, so both runs being wrong the same way would still fail.
    expect(await waterRepository.listIntakeRange("user-1", input.from, input.to)).toEqual([
      { userId: "user-1", day: "2026-01-01", totalMl: 750 },
      { userId: "user-1", day: "2026-07-02", totalMl: 100 },
      { userId: "user-1", day: "2026-07-03", totalMl: 500 },
      { userId: "user-1", day: "2027-12-31", totalMl: 400 },
    ]);
    expect(batchedSummary).toEqual({ imported: 4, skipped: 0, from: input.from, to: input.to });
  });

  it("writes nothing when a batch after the first fails", async () => {
    chaodaysClient.records = [
      // In the first batch, so a per-batch write would already have landed it.
      { date: "2026-01-01", waterMl: 250, recordedAt: "2026-01-01 09:00" },
      { date: "2027-12-31", waterMl: 300, recordedAt: "2027-12-31 09:00" },
    ];
    chaodaysClient.failOnFetchCall = 2;

    await expect(
      importChaodaysWater(waterRepository, chaodaysClient, {
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
    expect(waterRepository.addIntakeManyCallCount).toBe(0);
    expect(await waterRepository.listIntakeRange("user-1", "2026-01-01", "2027-12-31")).toEqual([]);
  });

  it("propagates a chaodays sign-in auth failure", async () => {
    chaodaysClient.signInError = new ChaodaysAuthError();

    await expect(
      importChaodaysWater(waterRepository, chaodaysClient, {
        userId: "user-1",
        uid: "chaodays-uid",
        password: "wrong-password",
        from: "2026-07-01",
        to: "2026-07-02",
      }),
    ).rejects.toThrow(ChaodaysAuthError);
  });
});
