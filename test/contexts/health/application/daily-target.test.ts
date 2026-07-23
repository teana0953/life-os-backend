import { beforeEach, describe, expect, it } from "vitest";
import { getDailyTargetWithRemaining } from "../../../../src/contexts/health/application/get-daily-target-with-remaining";
import { setDailyTarget } from "../../../../src/contexts/health/application/set-daily-target";
import type { DailyTarget } from "../../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../../../../src/contexts/health/domain/daily-target-repository";
import type { MealEntry, MealItem, MealSummary } from "../../../../src/contexts/health/domain/meal-entry";
import type {
  CreateMealItemInput,
  MealRepository,
  UpdateMealItemPatch,
  UpsertMealWithItemsInput,
} from "../../../../src/contexts/health/domain/meal-repository";

class InMemoryDailyTargetRepository implements DailyTargetRepository {
  private targetsByUserDay = new Map<string, DailyTarget>();
  private nextId = 1;

  async get(userId: string, day: string): Promise<DailyTarget | null> {
    return this.targetsByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async listInRange(): Promise<DailyTarget[]> {
    throw new Error("not used in this test");
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

type StoredMeal = MealSummary & { items: MealItem[] };

/** Minimal in-memory MealRepository; only what getDailyTargetWithRemaining needs (D6, task 5.2). */
class InMemoryMealRepository implements MealRepository {
  meals: StoredMeal[] = [];
  private nextItemId = 1;

  /** Test helper: seeds a meal item directly with per-unit portions and a quantity (default 1). */
  seedItem(userId: string, day: string, meal: string, portions: { staple: number; meat: number; fruit: number; veg: number }, quantity = 1): void {
    const mealRow: StoredMeal = { id: `meal-${this.meals.length + 1}`, userId, day, meal, time: new Date(), createdAt: new Date(), items: [] };
    this.meals.push(mealRow);
    const item: MealItem = {
      id: `item-${this.nextItemId++}`,
      mealEntryId: mealRow.id,
      foodItemId: null,
      name: null,
      photoRef: null,
      source: "manual",
      unclassified: false,
      carbG: 0,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 0,
      ...portions,
      quantity,
      baseAmount: null,
      measureUnit: null,
      createdAt: new Date(),
    };
    mealRow.items.push(item);
  }

  /** Test helper: seeds a meal with a nutrient-only, unclassified item (zero portions). */
  seedUnclassifiedItem(userId: string, day: string, meal: string, nutrients: { carbG: number; proteinG: number; fatG: number }): void {
    const mealRow: StoredMeal = { id: `meal-${this.meals.length + 1}`, userId, day, meal, time: new Date(), createdAt: new Date(), items: [] };
    this.meals.push(mealRow);
    const item: MealItem = {
      id: `item-${this.nextItemId++}`,
      mealEntryId: mealRow.id,
      foodItemId: null,
      name: null,
      photoRef: null,
      source: "manual",
      unclassified: true,
      ...nutrients,
      sugarG: 0,
      fiberG: 0,
      kcal: 0,
      staple: 0,
      meat: 0,
      fruit: 0,
      veg: 0,
      quantity: 1,
      baseAmount: null,
      measureUnit: null,
      createdAt: new Date(),
    };
    mealRow.items.push(item);
  }

  async upsertMealWithItems(input: UpsertMealWithItemsInput): Promise<MealEntry> {
    const items: MealItem[] = input.items.map((item: CreateMealItemInput) => ({
      id: `item-${this.nextItemId++}`,
      mealEntryId: "meal",
      createdAt: new Date(),
      ...item,
    }));
    const meal: StoredMeal = { id: "meal", userId: input.userId, day: input.day, meal: input.meal, time: input.time ?? new Date(), createdAt: new Date(), items };
    this.meals.push(meal);
    return meal;
  }

  async listMealsByDay(userId: string, day: string): Promise<MealEntry[]> {
    return this.meals.filter((m) => m.userId === userId && m.day === day);
  }

  async listMealsInRange(): Promise<MealEntry[]> {
    throw new Error("not used in this test");
  }

  async listLoggedDays(_userId: string, _month: string): Promise<string[]> {
    return [];
  }

  async updateMealTime(_userId: string, _mealId: string, _time: Date): Promise<MealSummary | null> {
    return null;
  }

  async deleteMeal(_userId: string, _mealId: string): Promise<boolean> {
    return false;
  }

  async updateItem(_userId: string, _itemId: string, _patch: UpdateMealItemPatch): Promise<MealItem | null> {
    return null;
  }

  async deleteItem(_userId: string, _itemId: string): Promise<boolean> {
    return false;
  }
}

let dailyTargets: InMemoryDailyTargetRepository;
let mealRepository: InMemoryMealRepository;

beforeEach(() => {
  dailyTargets = new InMemoryDailyTargetRepository();
  mealRepository = new InMemoryMealRepository();
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
  it("reports remaining as effective_target - sum(consumed portions), effective = base + bonus", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-18", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2, bonusStaple: 2 });
    mealRepository.seedItem("user-1", "2026-07-18", "breakfast", { staple: 9, meat: 0, fruit: 0, veg: 0 });

    const result = await getDailyTargetWithRemaining(dailyTargets, mealRepository, "user-1", "2026-07-18");

    expect(result.effective.staple).toBe(14); // base 12 + bonus 2
    expect(result.remaining.staple).toBe(5); // 14 - 9
  });

  it("sums the consumed amount (per-unit x quantity), not the per-unit value alone", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-18", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2 });
    mealRepository.seedItem("user-1", "2026-07-18", "breakfast", { staple: 3, meat: 0, fruit: 0, veg: 0 }, 2); // consumed 6

    const result = await getDailyTargetWithRemaining(dailyTargets, mealRepository, "user-1", "2026-07-18");

    expect(result.logged.staple).toBe(6);
    expect(result.remaining.staple).toBe(6); // 12 - 6
  });

  it("adds bonus to base for the effective target", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-18", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2, bonusStaple: 2 });

    const result = await getDailyTargetWithRemaining(dailyTargets, mealRepository, "user-1", "2026-07-18");

    expect(result.effective.staple).toBe(14);
  });

  it("does not let an unclassified nutrient-only item reduce any category's remaining portions", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-18", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2 });
    mealRepository.seedUnclassifiedItem("user-1", "2026-07-18", "snack", { carbG: 100, proteinG: 50, fatG: 20 });

    const result = await getDailyTargetWithRemaining(dailyTargets, mealRepository, "user-1", "2026-07-18");

    expect(result.remaining.staple).toBe(12);
    expect(result.remaining.meat).toBe(7);
  });

  it("carries forward the base from the most recent earlier target when the day has none of its own, with bonus 0", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-01", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2 });

    const result = await getDailyTargetWithRemaining(dailyTargets, mealRepository, "user-1", "2026-07-02");

    expect(result.base.staple).toBe(12);
    expect(result.bonus.staple).toBe(0);
    expect(result.effective.staple).toBe(12);
  });

  it("reports an all-zero target when the user has never set one", async () => {
    const result = await getDailyTargetWithRemaining(dailyTargets, mealRepository, "user-1", "2026-07-18");

    expect(result.base).toEqual({ staple: 0, meat: 0, fruit: 0, veg: 0 });
    expect(result.bonus).toEqual({ staple: 0, meat: 0, fruit: 0, veg: 0 });
    expect(result.effective).toEqual({ staple: 0, meat: 0, fruit: 0, veg: 0 });
  });

  it("does not carry forward the source day's bonus to a later untouched day", async () => {
    await dailyTargets.set({ userId: "user-1", day: "2026-07-01", baseStaple: 12, baseMeat: 7, baseFruit: 2, baseVeg: 2, bonusStaple: 3 });

    const result = await getDailyTargetWithRemaining(dailyTargets, mealRepository, "user-1", "2026-07-02");

    expect(result.base.staple).toBe(12);
    expect(result.bonus.staple).toBe(0);
    expect(result.effective.staple).toBe(12);
  });
});
