import { beforeEach, describe, expect, it } from "vitest";
import { importChaodaysBowel } from "../../../../src/contexts/health/application/import-chaodays-bowel";
import { ChaodaysAuthError } from "../../../../src/contexts/health/domain/chaodays-client";
import type { ChaodaysClient, ChaodaysDefecationRecord, ChaodaysSession } from "../../../../src/contexts/health/domain/chaodays-client";
import type { BowelLog } from "../../../../src/contexts/health/domain/bowel";
import type { BowelRepository, SetBowelLogInput } from "../../../../src/contexts/health/domain/bowel-repository";

class InMemoryBowelRepository implements BowelRepository {
  private byUserDay = new Map<string, BowelLog>();
  setManyCallCount = 0;

  async get(userId: string, day: string): Promise<BowelLog | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetBowelLogInput): Promise<BowelLog> {
    const log: BowelLog = {
      userId: input.userId,
      day: input.day,
      count: input.count,
      isNormal: input.isNormal,
      note: input.note,
    };
    this.byUserDay.set(`${input.userId}:${input.day}`, log);
    return log;
  }

  async setMany(rows: SetBowelLogInput[]): Promise<void> {
    this.setManyCallCount++;
    for (const row of rows) {
      await this.set(row);
    }
  }

  async listRange(userId: string, from: string, to: string): Promise<BowelLog[]> {
    return [...this.byUserDay.values()].filter((r) => r.userId === userId && r.day >= from && r.day <= to);
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

class FakeChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysDefecationRecord[] = [];
  signInArgs: { uid: string; password: string } | null = null;
  fetchArgs: { from: string; to: string } | null = null;
  signInCallCount = 0;
  fetchCalls: { from: string; to: string }[] = [];

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

  fetchWaterRecords(): never {
    throw new Error("not used in this test");
  }

  // Returns only the records inside `[from, to]`, like the real client — a fake
  // that ignored the range would hand every batch the same records, multiplying
  // each day's count by the number of batches.
  async fetchDefecationRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysDefecationRecord[] }> {
    this.fetchArgs = { from, to };
    this.fetchCalls.push({ from, to });
    return { session, records: this.records.filter((r) => r.date >= from && r.date <= to) };
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

let bowelRepository: InMemoryBowelRepository;
let chaodaysClient: FakeChaodaysClient;

beforeEach(() => {
  bowelRepository = new InMemoryBowelRepository();
  chaodaysClient = new FakeChaodaysClient();
});

describe("importChaodaysBowel", () => {
  it("aggregates a day's records into one bowel log and imports it", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", count: 1, isAbnormality: false, note: "早上" },
      { date: "2026-07-01", count: 1, isAbnormality: false, note: "晚上" },
    ];

    const summary = await importChaodaysBowel(bowelRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary).toEqual({ imported: 1, skipped: 0, from: "2026-07-01", to: "2026-07-01" });
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchArgs).toEqual({ from: "2026-07-01", to: "2026-07-01" });
    expect(await bowelRepository.get("user-1", "2026-07-01")).toEqual({
      userId: "user-1",
      day: "2026-07-01",
      count: 2,
      isNormal: true,
      note: "早上\n晚上",
    });
  });

  it("inverts the abnormality flag: isNormal is false when any record is abnormal", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", count: 1, isAbnormality: false, note: "" },
      { date: "2026-07-01", count: 1, isAbnormality: true, note: "" },
    ];

    await importChaodaysBowel(bowelRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect((await bowelRepository.get("user-1", "2026-07-01"))?.isNormal).toBe(false);
  });

  it("joins only non-empty notes with newlines", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", count: 1, isAbnormality: false, note: "" },
      { date: "2026-07-01", count: 1, isAbnormality: false, note: "note-a" },
      { date: "2026-07-01", count: 1, isAbnormality: false, note: "" },
      { date: "2026-07-01", count: 1, isAbnormality: false, note: "note-b" },
    ];

    await importChaodaysBowel(bowelRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect((await bowelRepository.get("user-1", "2026-07-01"))?.note).toBe("note-a\nnote-b");
  });

  it("skips a day that already has a lifeos bowel log, without clobbering it", async () => {
    await bowelRepository.set({ userId: "user-1", day: "2026-07-01", count: 5, isNormal: false, note: "manual" });
    chaodaysClient.records = [{ date: "2026-07-01", count: 1, isAbnormality: false, note: "" }];

    const summary = await importChaodaysBowel(bowelRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary).toEqual({ imported: 0, skipped: 1, from: "2026-07-01", to: "2026-07-01" });
    expect(await bowelRepository.get("user-1", "2026-07-01")).toEqual({
      userId: "user-1",
      day: "2026-07-01",
      count: 5,
      isNormal: false,
      note: "manual",
    });
  });

  it("reports zero imported and zero skipped for an empty range", async () => {
    chaodaysClient.records = [];

    const summary = await importChaodaysBowel(bowelRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(summary).toEqual({ imported: 0, skipped: 0, from: "2026-07-01", to: "2026-07-02" });
    expect(bowelRepository.setManyCallCount).toBe(0);
  });

  it("persists a multi-day range via one setMany call, not per-day", async () => {
    chaodaysClient.records = [
      { date: "2026-07-01", count: 1, isAbnormality: false, note: "" },
      { date: "2026-07-02", count: 2, isAbnormality: false, note: "" },
      { date: "2026-07-03", count: 1, isAbnormality: true, note: "" },
    ];

    const summary = await importChaodaysBowel(bowelRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-03",
    });

    expect(summary).toEqual({ imported: 3, skipped: 0, from: "2026-07-01", to: "2026-07-03" });
    expect(bowelRepository.setManyCallCount).toBe(1);
  });

  it("fetches a range longer than the batch size as several contiguous requests, signing in once", async () => {
    chaodaysClient.records = [
      { date: "2026-01-01", count: 1, isAbnormality: false, note: "" },
      // Either side of the first 183-day boundary; two records on the boundary
      // day so a repeated batch would double its count.
      { date: "2026-07-02", count: 1, isAbnormality: false, note: "" },
      { date: "2026-07-02", count: 2, isAbnormality: false, note: "" },
      { date: "2026-07-03", count: 1, isAbnormality: false, note: "" },
      { date: "2027-12-31", count: 1, isAbnormality: false, note: "" },
    ];

    const summary = await importChaodaysBowel(bowelRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-01-01",
      to: "2027-12-31",
    });

    expectContiguousCover(chaodaysClient.fetchCalls, "2026-01-01", "2027-12-31");
    expect(chaodaysClient.signInCallCount).toBe(1);
    expect(summary).toEqual({ imported: 4, skipped: 0, from: "2026-01-01", to: "2027-12-31" });
    expect((await bowelRepository.get("user-1", "2026-07-02"))?.count).toBe(3);
    expect((await bowelRepository.get("user-1", "2026-07-03"))?.count).toBe(1);
  });

  it("propagates a chaodays sign-in auth failure", async () => {
    chaodaysClient.signInError = new ChaodaysAuthError();

    await expect(
      importChaodaysBowel(bowelRepository, chaodaysClient, {
        userId: "user-1",
        uid: "chaodays-uid",
        password: "wrong-password",
        from: "2026-07-01",
        to: "2026-07-02",
      }),
    ).rejects.toThrow(ChaodaysAuthError);
  });
});
