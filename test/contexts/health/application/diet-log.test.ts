import { beforeEach, describe, expect, it } from "vitest";
import { deleteFoodEntry } from "../../../../src/contexts/health/application/delete-food-entry";
import { getDayDietLog } from "../../../../src/contexts/health/application/get-day-diet-log";
import { logFoodEntryFromDictionary } from "../../../../src/contexts/health/application/log-food-entry-from-dictionary";
import { logManualFoodEntry } from "../../../../src/contexts/health/application/log-manual-food-entry";
import type { CreateFoodEntryInput, DietLogRepository } from "../../../../src/contexts/health/domain/diet-log-repository";
import type { FoodDictionaryRepository } from "../../../../src/contexts/health/domain/food-dictionary-repository";
import type { FoodEntry } from "../../../../src/contexts/health/domain/food-entry";
import type { FoodItem } from "../../../../src/contexts/health/domain/food-item";

class InMemoryDietLogRepository implements DietLogRepository {
  entries: FoodEntry[] = [];
  private nextId = 1;
  private nextLoggedAt = Date.parse("2026-07-18T08:00:00.000Z");

  async create(input: CreateFoodEntryInput): Promise<FoodEntry> {
    const entry: FoodEntry = { id: String(this.nextId++), loggedAt: new Date(this.nextLoggedAt), ...input };
    this.nextLoggedAt += 1000 * 60; // each entry logged a minute after the previous, for deterministic ordering
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
}

class StubFoodDictionaryRepository implements Pick<FoodDictionaryRepository, "findById"> {
  constructor(private readonly item: FoodItem) {}
  async findById(id: string): Promise<FoodItem | null> {
    return id === this.item.id ? this.item : null;
  }
}

const banana: FoodItem = {
  id: "item-banana",
  ownerUserId: null,
  name: "香蕉/1根",
  carbG: 30,
  proteinG: 0,
  fatG: 0,
  sugarG: 30,
  fiberG: 0,
  kcal: 120,
  staple: 0,
  meat: 0,
  fruit: 2,
  veg: 0,
  createdAt: new Date(),
};

let dietLog: InMemoryDietLogRepository;

beforeEach(() => {
  dietLog = new InMemoryDietLogRepository();
});

describe("logManualFoodEntry", () => {
  it("derives nutrients from supplied portions (2 staple -> ~30 g carbohydrate)", async () => {
    const entry = await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      portions: { staple: 2, meat: 0, fruit: 0, veg: 0 },
    });

    expect(entry.carbG).toBe(30);
    expect(entry.staple).toBe(2);
    expect(entry.source).toBe("manual");
    expect(entry.unclassified).toBe(false);
  });

  it("marks a nutrient-only entry unclassified with zero portions, storing nutrients as given", async () => {
    const entry = await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "snack",
      nutrients: { carbG: 20, proteinG: 10, fatG: 5, sugarG: 2, fiberG: 1, kcal: 200 },
    });

    expect(entry.unclassified).toBe(true);
    expect(entry.staple).toBe(0);
    expect(entry.meat).toBe(0);
    expect(entry.fruit).toBe(0);
    expect(entry.veg).toBe(0);
    expect(entry.carbG).toBe(20);
    expect(entry.kcal).toBe(200);
  });

  it("falls back to the macro formula for kcal when a nutrient-only entry has no explicit kcal", async () => {
    const entry = await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "snack",
      nutrients: { carbG: 10, proteinG: 5, fatG: 2, sugarG: 0, fiberG: 0 },
    });

    expect(entry.kcal).toBe(10 * 4 + 5 * 4 + 2 * 9);
  });
});

describe("logFoodEntryFromDictionary", () => {
  it("copies the dictionary item's nutrients and portions, and sets source to dict", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(banana) as unknown as FoodDictionaryRepository;

    const entry = await logFoodEntryFromDictionary(dietLog, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      foodItemId: banana.id,
    });

    expect(entry.source).toBe("dict");
    expect(entry.fruit).toBe(2);
    expect(entry.carbG).toBe(30);
    expect(entry.unclassified).toBe(false);
  });
});

describe("getDayDietLog", () => {
  it("groups a day's entries by meal in chronological order", async () => {
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "lunch", portions: { staple: 2, meat: 0, fruit: 0, veg: 0 } });
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "breakfast", portions: { staple: 0, meat: 1, fruit: 0, veg: 0 } });

    const dayLog = await getDayDietLog(dietLog, "user-1", "2026-07-18");

    expect(dayLog.meals.map((m) => m.meal)).toEqual(["breakfast", "lunch"]);
    expect(dayLog.meals[0]?.entries).toHaveLength(2);
    expect(dayLog.meals[1]?.entries).toHaveLength(1);
  });

  it("computes day nutrient/calorie totals from atomic fields only, independent of portions", async () => {
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }); // 15 g carb
    await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "snack",
      nutrients: { carbG: 5, proteinG: 3, fatG: 1, sugarG: 0, fiberG: 0, kcal: 50 },
    }); // unclassified, zero portions

    const dayLog = await getDayDietLog(dietLog, "user-1", "2026-07-18");

    expect(dayLog.totals.carbG).toBe(20);
    expect(dayLog.totals.kcal).toBe(15 * 4 + 50);
  });
});

describe("deleteFoodEntry", () => {
  it("removes the entry from the day's log and totals", async () => {
    const entry = await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "breakfast", portions: { staple: 2, meat: 0, fruit: 0, veg: 0 } });

    await deleteFoodEntry(dietLog, "user-1", entry.id);
    const dayLog = await getDayDietLog(dietLog, "user-1", "2026-07-18");

    expect(dayLog.meals).toEqual([]);
    expect(dayLog.totals.carbG).toBe(0);
  });

  it("does not delete another user's entry", async () => {
    const entry = await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "breakfast", portions: { staple: 2, meat: 0, fruit: 0, veg: 0 } });

    const deleted = await deleteFoodEntry(dietLog, "user-2", entry.id);

    expect(deleted).toBe(false);
    expect(await dietLog.listByDay("user-1", "2026-07-18")).toHaveLength(1);
  });
});
