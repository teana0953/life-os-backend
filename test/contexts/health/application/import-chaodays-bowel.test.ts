import { beforeEach, describe, expect, it } from "vitest";
import { importChaodaysBowel } from "../../../../src/contexts/health/application/import-chaodays-bowel";
import { ChaodaysAuthError } from "../../../../src/contexts/health/domain/chaodays-client";
import type { ChaodaysClient, ChaodaysDefecationRecord, ChaodaysSession } from "../../../../src/contexts/health/domain/chaodays-client";
import type { BowelLog } from "../../../../src/contexts/health/domain/bowel";
import type { BowelRepository, SetBowelLogInput } from "../../../../src/contexts/health/domain/bowel-repository";

class InMemoryBowelRepository implements BowelRepository {
  private byUserDay = new Map<string, BowelLog>();

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
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

class FakeChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysDefecationRecord[] = [];
  signInArgs: { uid: string; password: string } | null = null;
  fetchArgs: { from: string; to: string } | null = null;

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    this.signInArgs = { uid, password };
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

  async fetchDefecationRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysDefecationRecord[] }> {
    this.fetchArgs = { from, to };
    return { session, records: this.records };
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
