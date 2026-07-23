import { beforeEach, describe, expect, it } from "vitest";
import { importChaodaysWater } from "../../../../src/contexts/health/application/import-chaodays-water";
import { ChaodaysAuthError } from "../../../../src/contexts/health/domain/chaodays-client";
import type { ChaodaysClient, ChaodaysSession, ChaodaysWaterRecord } from "../../../../src/contexts/health/domain/chaodays-client";
import type { WaterIntake, WaterTarget } from "../../../../src/contexts/health/domain/water";
import type { SetWaterTargetInput, WaterRepository } from "../../../../src/contexts/health/domain/water-repository";

class InMemoryWaterRepository implements WaterRepository {
  private intakeByUserDay = new Map<string, WaterIntake>();

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

  async getTarget(): Promise<WaterTarget | null> {
    throw new Error("not used in this test");
  }

  async getLatestTargetOnOrBefore(): Promise<WaterTarget | null> {
    throw new Error("not used in this test");
  }

  async setTarget(_input: SetWaterTargetInput): Promise<WaterTarget> {
    throw new Error("not used in this test");
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

class FakeChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysWaterRecord[] = [];
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

  async fetchWaterRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWaterRecord[] }> {
    this.fetchArgs = { from, to };
    return { session, records: this.records };
  }

  fetchDefecationRecords(): never {
    throw new Error("not used in this test");
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
  });

  it("handles multiple days independently", async () => {
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
