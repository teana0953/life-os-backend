import { beforeEach, describe, expect, it } from "vitest";
import { addWater } from "../../../../src/contexts/health/application/add-water";
import { getWaterDay } from "../../../../src/contexts/health/application/get-water-day";
import { setWaterTarget } from "../../../../src/contexts/health/application/set-water-target";
import type { WaterIntake, WaterTarget } from "../../../../src/contexts/health/domain/water";
import type { SetWaterTargetInput, WaterRepository } from "../../../../src/contexts/health/domain/water-repository";

class InMemoryWaterRepository implements WaterRepository {
  private intakeByUserDay = new Map<string, WaterIntake>();
  private targetByUserDay = new Map<string, WaterTarget>();

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

  async getTarget(userId: string, day: string): Promise<WaterTarget | null> {
    return this.targetByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async getLatestTargetOnOrBefore(userId: string, day: string): Promise<WaterTarget | null> {
    let latest: WaterTarget | null = null;
    for (const target of this.targetByUserDay.values()) {
      if (target.userId === userId && target.day <= day && (!latest || target.day > latest.day)) {
        latest = target;
      }
    }
    return latest;
  }

  async setTarget(input: SetWaterTargetInput): Promise<WaterTarget> {
    const target: WaterTarget = { userId: input.userId, day: input.day, targetMl: input.targetMl };
    this.targetByUserDay.set(`${input.userId}:${input.day}`, target);
    return target;
  }
}

let repo: InMemoryWaterRepository;

beforeEach(() => {
  repo = new InMemoryWaterRepository();
});

describe("addWater", () => {
  it("accumulates the day's total across adds", async () => {
    await addWater(repo, "user-1", "2026-07-18", 250);
    const intake = await addWater(repo, "user-1", "2026-07-18", 500);

    expect(intake.totalMl).toBe(750);
  });

  it("never drives the stored total below zero on a negative correction", async () => {
    await addWater(repo, "user-1", "2026-07-18", 200);
    const intake = await addWater(repo, "user-1", "2026-07-18", -500);

    expect(intake.totalMl).toBe(0);
  });
});

describe("setWaterTarget", () => {
  it("upserts the day's target", async () => {
    await setWaterTarget(repo, { userId: "user-1", day: "2026-07-18", targetMl: 2000 });
    const target = await setWaterTarget(repo, { userId: "user-1", day: "2026-07-18", targetMl: 2500 });

    expect(target.targetMl).toBe(2500);
    expect(await repo.getTarget("user-1", "2026-07-18")).toEqual({ userId: "user-1", day: "2026-07-18", targetMl: 2500 });
  });
});

describe("getWaterDay", () => {
  it("returns the exact day's target and reads the total, remaining = target - total", async () => {
    await setWaterTarget(repo, { userId: "user-1", day: "2026-07-18", targetMl: 2000 });
    await addWater(repo, "user-1", "2026-07-18", 750);

    const result = await getWaterDay(repo, "user-1", "2026-07-18");

    expect(result).toEqual({ day: "2026-07-18", totalMl: 750, targetMl: 2000, remainingMl: 1250 });
  });

  it("carries forward the latest earlier target when the day has none of its own", async () => {
    await setWaterTarget(repo, { userId: "user-1", day: "2026-07-01", targetMl: 2000 });

    const result = await getWaterDay(repo, "user-1", "2026-07-02");

    expect(result.targetMl).toBe(2000);
  });

  it("reports a zero target when the user has never set one", async () => {
    const result = await getWaterDay(repo, "user-1", "2026-07-18");

    expect(result.targetMl).toBe(0);
    expect(result.totalMl).toBe(0);
    expect(result.remainingMl).toBe(0);
  });

  it("allows remaining to be negative when over the target", async () => {
    await setWaterTarget(repo, { userId: "user-1", day: "2026-07-18", targetMl: 2000 });
    await addWater(repo, "user-1", "2026-07-18", 2200);

    const result = await getWaterDay(repo, "user-1", "2026-07-18");

    expect(result.remainingMl).toBe(-200);
  });
});
