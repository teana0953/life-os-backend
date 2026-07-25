import { beforeEach, describe, expect, it } from "vitest";
import { importChaodaysDietTarget } from "../../../../src/contexts/health/application/import-chaodays-diet-target";
import { ChaodaysAuthError } from "../../../../src/contexts/health/domain/chaodays-client";
import type { ChaodaysClient, ChaodaysDietMenu, ChaodaysSession } from "../../../../src/contexts/health/domain/chaodays-client";
import type { DailyTarget } from "../../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../../../../src/contexts/health/domain/daily-target-repository";
import type { WaterTarget } from "../../../../src/contexts/health/domain/water";
import type { SetWaterTargetInput, WaterRepository } from "../../../../src/contexts/health/domain/water-repository";

class InMemoryDailyTargetRepository implements DailyTargetRepository {
  private targetsByUserDay = new Map<string, DailyTarget>();
  private nextId = 1;
  setManyCallCount = 0;

  async get(userId: string, day: string): Promise<DailyTarget | null> {
    return this.targetsByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async getLatestOnOrBefore(): Promise<DailyTarget | null> {
    throw new Error("not used in this test");
  }

  async listInRange(userId: string, from: string, to: string): Promise<DailyTarget[]> {
    return [...this.targetsByUserDay.values()].filter((t) => t.userId === userId && t.day >= from && t.day <= to);
  }

  async set(input: SetDailyTargetInput): Promise<DailyTarget> {
    const target: DailyTarget = {
      id: `target-${this.nextId++}`,
      userId: input.userId,
      day: input.day,
      baseStaple: input.baseStaple,
      baseMeat: input.baseMeat,
      baseFruit: input.baseFruit,
      baseVeg: input.baseVeg,
      bonusStaple: input.bonusStaple ?? 0,
      bonusMeat: input.bonusMeat ?? 0,
      bonusFruit: input.bonusFruit ?? 0,
      bonusVeg: input.bonusVeg ?? 0,
    };
    this.targetsByUserDay.set(`${input.userId}:${input.day}`, target);
    return target;
  }

  async setMany(rows: SetDailyTargetInput[]): Promise<void> {
    this.setManyCallCount++;
    for (const row of rows) {
      // Mirror the Drizzle adapter's contract: an omitted bonus is left
      // untouched on conflict (not reset to 0), so the exercise bonus survives.
      const existing = this.targetsByUserDay.get(`${row.userId}:${row.day}`);
      const target: DailyTarget = {
        id: existing?.id ?? `target-${this.nextId++}`,
        userId: row.userId,
        day: row.day,
        baseStaple: row.baseStaple,
        baseMeat: row.baseMeat,
        baseFruit: row.baseFruit,
        baseVeg: row.baseVeg,
        bonusStaple: row.bonusStaple ?? existing?.bonusStaple ?? 0,
        bonusMeat: row.bonusMeat ?? existing?.bonusMeat ?? 0,
        bonusFruit: row.bonusFruit ?? existing?.bonusFruit ?? 0,
        bonusVeg: row.bonusVeg ?? existing?.bonusVeg ?? 0,
      };
      this.targetsByUserDay.set(`${row.userId}:${row.day}`, target);
    }
  }
}

class InMemoryWaterRepository implements WaterRepository {
  private targetByUserDay = new Map<string, WaterTarget>();
  setTargetManyCallCount = 0;

  async getIntake(): Promise<null> {
    throw new Error("not used in this test");
  }

  async addIntake(): Promise<never> {
    throw new Error("not used in this test");
  }

  async addIntakeMany(): Promise<void> {
    throw new Error("not used in this test");
  }

  async listIntakeRange(): Promise<never[]> {
    throw new Error("not used in this test");
  }

  async getTarget(userId: string, day: string): Promise<WaterTarget | null> {
    return this.targetByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async getLatestTargetOnOrBefore(): Promise<WaterTarget | null> {
    throw new Error("not used in this test");
  }

  async listTargetRange(userId: string, from: string, to: string): Promise<WaterTarget[]> {
    return [...this.targetByUserDay.values()].filter((t) => t.userId === userId && t.day >= from && t.day <= to);
  }

  async setTarget(input: SetWaterTargetInput): Promise<WaterTarget> {
    const target: WaterTarget = { userId: input.userId, day: input.day, targetMl: input.targetMl };
    this.targetByUserDay.set(`${input.userId}:${input.day}`, target);
    return target;
  }

  async setTargetMany(rows: SetWaterTargetInput[]): Promise<void> {
    this.setTargetManyCallCount++;
    for (const row of rows) {
      this.targetByUserDay.set(`${row.userId}:${row.day}`, { userId: row.userId, day: row.day, targetMl: row.targetMl });
    }
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

class FakeChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  menus: ChaodaysDietMenu[] = [];
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

  fetchDefecationRecords(): never {
    throw new Error("not used in this test");
  }

  async fetchDietMenus(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; menus: ChaodaysDietMenu[] }> {
    this.fetchArgs = { from, to };
    return { session, menus: this.menus };
  }
}

let dailyTargetRepository: InMemoryDailyTargetRepository;
let waterRepository: InMemoryWaterRepository;
let chaodaysClient: FakeChaodaysClient;

beforeEach(() => {
  dailyTargetRepository = new InMemoryDailyTargetRepository();
  waterRepository = new InMemoryWaterRepository();
  chaodaysClient = new FakeChaodaysClient();
});

describe("importChaodaysDietTarget", () => {
  it("imports the portion target and water target for a day with both present", async () => {
    chaodaysClient.menus = [{ date: "2026-07-01", staple: 12, meat: 6, fruit: 2, veg: 3, waterTargetMl: 2000 }];

    const summary = await importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary).toEqual({
      portionTargetsImported: 1,
      portionTargetsSkipped: 0,
      waterTargetsImported: 1,
      waterTargetsSkipped: 0,
      from: "2026-07-01",
      to: "2026-07-01",
    });
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchArgs).toEqual({ from: "2026-07-01", to: "2026-07-01" });
    expect(await dailyTargetRepository.get("user-1", "2026-07-01")).toMatchObject({
      baseStaple: 12,
      baseMeat: 6,
      baseFruit: 2,
      baseVeg: 3,
      bonusStaple: 0,
    });
    expect(await waterRepository.getTarget("user-1", "2026-07-01")).toEqual({
      userId: "user-1",
      day: "2026-07-01",
      targetMl: 2000,
    });
  });

  it("skips a day that already has a daily target, preserving its exercise bonus", async () => {
    await dailyTargetRepository.set({
      userId: "user-1",
      day: "2026-07-01",
      baseStaple: 5,
      baseMeat: 5,
      baseFruit: 5,
      baseVeg: 5,
      bonusStaple: 2,
      bonusMeat: 2,
    });
    chaodaysClient.menus = [{ date: "2026-07-01", staple: 12, meat: 6, fruit: 2, veg: 3, waterTargetMl: 0 }];

    const summary = await importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary.portionTargetsImported).toBe(0);
    expect(summary.portionTargetsSkipped).toBe(1);
    const target = await dailyTargetRepository.get("user-1", "2026-07-01");
    expect(target).toMatchObject({ baseStaple: 5, bonusStaple: 2, bonusMeat: 2 });
  });

  it("writes no daily target for an all-zero-portion menu, counting it as skipped", async () => {
    chaodaysClient.menus = [{ date: "2026-07-01", staple: 0, meat: 0, fruit: 0, veg: 0, waterTargetMl: 0 }];

    const summary = await importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary.portionTargetsImported).toBe(0);
    expect(summary.portionTargetsSkipped).toBe(1);
    expect(await dailyTargetRepository.get("user-1", "2026-07-01")).toBeNull();
    expect(dailyTargetRepository.setManyCallCount).toBe(0);
  });

  it("imports a water target only when > 0 and absent; skips when present or 0", async () => {
    await waterRepository.setTarget({ userId: "user-1", day: "2026-07-02", targetMl: 1500 });
    chaodaysClient.menus = [
      { date: "2026-07-01", staple: 0, meat: 0, fruit: 0, veg: 0, waterTargetMl: 2000 }, // absent + >0 → imported
      { date: "2026-07-02", staple: 0, meat: 0, fruit: 0, veg: 0, waterTargetMl: 1800 }, // present → skipped
      { date: "2026-07-03", staple: 0, meat: 0, fruit: 0, veg: 0, waterTargetMl: 0 }, // 0 → skipped
    ];

    const summary = await importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-03",
    });

    expect(summary.waterTargetsImported).toBe(1);
    expect(summary.waterTargetsSkipped).toBe(2);
    expect((await waterRepository.getTarget("user-1", "2026-07-01"))?.targetMl).toBe(2000);
    expect((await waterRepository.getTarget("user-1", "2026-07-02"))?.targetMl).toBe(1500); // unchanged
    expect(await waterRepository.getTarget("user-1", "2026-07-03")).toBeNull();
  });

  it("is idempotent on re-import: the second run skips everything and changes nothing", async () => {
    chaodaysClient.menus = [{ date: "2026-07-01", staple: 12, meat: 6, fruit: 2, veg: 3, waterTargetMl: 2000 }];

    await importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });
    const summary = await importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-01",
    });

    expect(summary).toEqual({
      portionTargetsImported: 0,
      portionTargetsSkipped: 1,
      waterTargetsImported: 0,
      waterTargetsSkipped: 1,
      from: "2026-07-01",
      to: "2026-07-01",
    });
    expect(await dailyTargetRepository.get("user-1", "2026-07-01")).toMatchObject({ baseStaple: 12 });
    expect((await waterRepository.getTarget("user-1", "2026-07-01"))?.targetMl).toBe(2000);
  });

  it("reports zero counts for an empty range and makes zero batch write calls", async () => {
    chaodaysClient.menus = [];

    const summary = await importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(summary).toEqual({
      portionTargetsImported: 0,
      portionTargetsSkipped: 0,
      waterTargetsImported: 0,
      waterTargetsSkipped: 0,
      from: "2026-07-01",
      to: "2026-07-02",
    });
    expect(dailyTargetRepository.setManyCallCount).toBe(0);
    expect(waterRepository.setTargetManyCallCount).toBe(0);
  });

  it("persists multiple days via one batched setMany call and one batched setTargetMany call", async () => {
    chaodaysClient.menus = [
      { date: "2026-07-01", staple: 12, meat: 6, fruit: 2, veg: 3, waterTargetMl: 2000 },
      { date: "2026-07-02", staple: 10, meat: 5, fruit: 1, veg: 2, waterTargetMl: 1800 },
    ];

    const summary = await importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
      userId: "user-1",
      uid: "chaodays-uid",
      password: "chaodays-pw",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(summary.portionTargetsImported).toBe(2);
    expect(summary.waterTargetsImported).toBe(2);
    expect(dailyTargetRepository.setManyCallCount).toBe(1);
    expect(waterRepository.setTargetManyCallCount).toBe(1);
  });

  it("propagates a chaodays sign-in auth failure", async () => {
    chaodaysClient.signInError = new ChaodaysAuthError();

    await expect(
      importChaodaysDietTarget(dailyTargetRepository, waterRepository, chaodaysClient, {
        userId: "user-1",
        uid: "chaodays-uid",
        password: "wrong-password",
        from: "2026-07-01",
        to: "2026-07-02",
      }),
    ).rejects.toThrow(ChaodaysAuthError);
  });
});
