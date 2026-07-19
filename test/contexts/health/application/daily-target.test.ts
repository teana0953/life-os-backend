import { beforeEach, describe, expect, it } from "vitest";
import { getDailyTargetWithRemaining } from "../../../../src/contexts/health/application/get-daily-target-with-remaining";
import { logManualFoodEntry } from "../../../../src/contexts/health/application/log-manual-food-entry";
import { setDailyTarget } from "../../../../src/contexts/health/application/set-daily-target";
import type { DailyTarget } from "../../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../../../../src/contexts/health/domain/daily-target-repository";
import { portionsToNutrients } from "../../../../src/contexts/health/domain/conversion";
import type {
  CreateFoodEntryInput,
  DietLogRepository,
  UpdateFoodEntryPatch,
} from "../../../../src/contexts/health/domain/diet-log-repository";
import type { FoodEntry } from "../../../../src/contexts/health/domain/food-entry";

class InMemoryDailyTargetRepository implements DailyTargetRepository {
  private targetsByUserDay = new Map<string, DailyTarget>();
  private nextId = 1;

  async get(userId: string, day: string): Promise<DailyTarget | null> {
    return this.targetsByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async getLatestOnOrBefore(userId: string, day: string): Promise<DailyTarget | null> {
    let latest: DailyTarget | null = null;
    for (const target of this.targetsByUserDay.values()) {
      if (target.userId === userId && target.day <= day && (!latest || target.day > latest.day)) {
        latest = target;
      }
    }
    return latest;
  }

  async set(input: SetDailyTargetInput): Promise<DailyTarget> {
    const target: DailyTarget = {
      id: String(this.nextId++),
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
}

class InMemoryDietLogRepository implements DietLogRepository {
  entries: FoodEntry[] = [];
  private nextId = 1;

  async create(input: CreateFoodEntryInput): Promise<FoodEntry> {
    const entry: FoodEntry = { id: String(this.nextId++), loggedAt: new Date(), ...input };
    this.entries.push(entry);
    return entry;
  }

  async listByDay(userId: string, day: string): Promise<FoodEntry[]> {
    return this.entries.filter((e) => e.userId === userId && e.day === day);
  }

  async delete(userId: string, entryId: string): Promise<boolean> {
    const idx = this.entries.findIndex((e) => e.userId === userId && e.id === entryId);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  async update(userId: string, entryId: string, patch: UpdateFoodEntryPatch): Promise<FoodEntry | null> {
    const entry = this.entries.find((e) => e.userId === userId && e.id === entryId);
    if (!entry) return null;

    if (patch.name !== undefined) entry.name = patch.name;
    if (patch.meal !== undefined) entry.meal = patch.meal;
    if (patch.eatenAt !== undefined) {
      entry.eatenAt = patch.eatenAt;
      entry.day = patch.eatenAt.toISOString().slice(0, 10);
    }
    if (patch.portions !== undefined) {
      const nutrients = portionsToNutrients(patch.portions);
      entry.unclassified = false;
      Object.assign(entry, nutrients, patch.portions);
    }
    return entry;
  }
}

let dailyTargets: InMemoryDailyTargetRepository;
let dietLog: InMemoryDietLogRepository;

beforeEach(() => {
  dailyTargets = new InMemoryDailyTargetRepository();
  dietLog = new InMemoryDietLogRepository();
});

describe("setDailyTarget", () => {
  it("sets the base per-category goals for a day, defaulting bonus to 0", async () => {
    const target = await setDailyTarget(dailyTargets, {
      userId: "user-1",
      day: "2026-07-18",
      baseStaple: 12,
      baseMeat: 7,
      baseFruit: 2,
      baseVeg: 2,
    });

    expect(target.baseStaple).toBe(12);
    expect(target.bonusStaple).toBe(0);
  });
});

describe("getDailyTargetWithRemaining", () => {
  it("reports remaining as effective_target - sum(logged portions), effective = base + bonus", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-18", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2, bonusStaple: 2 });
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "breakfast", portions: { staple: 9, meat: 0, fruit: 0, veg: 0 } });

    const result = await getDailyTargetWithRemaining(dailyTargets, dietLog, "user-1", "2026-07-18");

    expect(result.effective.staple).toBe(14); // base 12 + bonus 2
    expect(result.remaining.staple).toBe(5); // 14 - 9
  });

  it("adds bonus to base for the effective target", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-18", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2, bonusStaple: 2 });

    const result = await getDailyTargetWithRemaining(dailyTargets, dietLog, "user-1", "2026-07-18");

    expect(result.effective.staple).toBe(14);
  });

  it("does not let an unclassified nutrient-only entry reduce any category's remaining portions", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-18", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2 });
    await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "snack",
      nutrients: { carbG: 100, proteinG: 50, fatG: 20, sugarG: 0, fiberG: 0 },
    });

    const result = await getDailyTargetWithRemaining(dailyTargets, dietLog, "user-1", "2026-07-18");

    expect(result.remaining.staple).toBe(12);
    expect(result.remaining.meat).toBe(7);
  });

  it("carries forward the base from the most recent earlier target when the day has none of its own, with bonus 0", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-01", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2 });

    const result = await getDailyTargetWithRemaining(dailyTargets, dietLog, "user-1", "2026-07-02");

    expect(result.base.staple).toBe(12);
    expect(result.bonus.staple).toBe(0);
    expect(result.effective.staple).toBe(12);
  });

  it("reports an all-zero target when the user has never set one", async () => {
    const result = await getDailyTargetWithRemaining(dailyTargets, dietLog, "user-1", "2026-07-18");

    expect(result.base).toEqual({ staple: 0, meat: 0, fruit: 0, veg: 0 });
    expect(result.bonus).toEqual({ staple: 0, meat: 0, fruit: 0, veg: 0 });
    expect(result.effective).toEqual({ staple: 0, meat: 0, fruit: 0, veg: 0 });
  });

  it("does not carry forward the source day's bonus to a later untouched day", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-01", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2, bonusStaple: 3 });

    const result = await getDailyTargetWithRemaining(dailyTargets, dietLog, "user-1", "2026-07-02");

    expect(result.base.staple).toBe(12);
    expect(result.bonus.staple).toBe(0);
    expect(result.effective.staple).toBe(12);
  });
});
