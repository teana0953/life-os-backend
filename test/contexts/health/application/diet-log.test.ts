import { beforeEach, describe, expect, it } from "vitest";
import { deleteFoodEntry } from "../../../../src/contexts/health/application/delete-food-entry";
import { getDayDietLog } from "../../../../src/contexts/health/application/get-day-diet-log";
import { getLoggedDays } from "../../../../src/contexts/health/application/get-logged-days";
import { logFoodEntryFromDictionary } from "../../../../src/contexts/health/application/log-food-entry-from-dictionary";
import { logManualFoodEntry } from "../../../../src/contexts/health/application/log-manual-food-entry";
import { EmptyUpdateError, updateFoodEntry } from "../../../../src/contexts/health/application/update-food-entry";
import { portionsToNutrients } from "../../../../src/contexts/health/domain/conversion";
import type {
  CreateFoodEntryInput,
  DietLogRepository,
  UpdateFoodEntryPatch,
} from "../../../../src/contexts/health/domain/diet-log-repository";
import type { FoodDictionaryRepository } from "../../../../src/contexts/health/domain/food-dictionary-repository";
import type { FoodEntry } from "../../../../src/contexts/health/domain/food-entry";
import type { FoodItem } from "../../../../src/contexts/health/domain/food-item";
import { NullBaseGramsError } from "../../../../src/contexts/health/domain/quantity";

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

  async listLoggedDays(userId: string, month: string): Promise<string[]> {
    const days = new Set(
      this.entries.filter((e) => e.userId === userId && e.day.startsWith(month)).map((e) => e.day),
    );
    return [...days].sort();
  }
}

class StubFoodDictionaryRepository implements Pick<FoodDictionaryRepository, "findById"> {
  constructor(private readonly item: FoodItem) {}
  async findById(userId: string, id: string): Promise<FoodItem | null> {
    if (id !== this.item.id) return null;
    return this.item.ownerUserId === null || this.item.ownerUserId === userId ? this.item : null;
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
  baseGrams: null,
  createdAt: new Date(),
};

const riceBowl: FoodItem = {
  id: "item-rice-bowl",
  ownerUserId: null,
  name: "飯/1碗",
  carbG: 60,
  proteinG: 0,
  fatG: 0,
  sugarG: 0,
  fiberG: 0,
  kcal: 240,
  staple: 4,
  meat: 0,
  fruit: 0,
  veg: 0,
  baseGrams: null,
  createdAt: new Date(),
};

const riceGram: FoodItem = {
  id: "item-rice-50g",
  ownerUserId: null,
  name: "飯/50g",
  carbG: 15,
  proteinG: 0,
  fatG: 0,
  sugarG: 0,
  fiberG: 0,
  kcal: 60,
  staple: 1,
  meat: 0,
  fruit: 0,
  veg: 0,
  baseGrams: 50,
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

  it("defaults eaten_at to the creation time when not supplied", async () => {
    const before = Date.now();

    const entry = await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
    });

    const after = Date.now();
    expect(entry.eatenAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(entry.eatenAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("stores a user-supplied eaten_at while logged_at remains system-assigned", async () => {
    const eatenAt = new Date("2026-07-01T08:00:00.000Z");

    const entry = await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
      eatenAt,
    });

    expect(entry.eatenAt).toEqual(eatenAt);
    expect(entry.loggedAt.getTime()).not.toBe(eatenAt.getTime());
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

  it("does not let a user log another user's private custom item", async () => {
    const foreign: FoodItem = { ...banana, id: "item-foreign", ownerUserId: "user-A" };
    const foodDictionary = new StubFoodDictionaryRepository(foreign) as unknown as FoodDictionaryRepository;

    await expect(
      logFoodEntryFromDictionary(dietLog, foodDictionary, {
        userId: "user-B",
        day: "2026-07-18",
        meal: "breakfast",
        foodItemId: foreign.id,
      }),
    ).rejects.toThrow();
  });

  it("defaults to quantity 1, reproducing the item's values unchanged", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    const entry = await logFoodEntryFromDictionary(dietLog, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      foodItemId: riceBowl.id,
    });

    expect(entry.staple).toBe(4);
    expect(entry.carbG).toBe(60);
  });

  it("scales portions and nutrients by a given quantity (1.5 -> 6 staple, 90 g carbohydrate)", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    const entry = await logFoodEntryFromDictionary(dietLog, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      foodItemId: riceBowl.id,
      quantity: 1.5,
    });

    expect(entry.staple).toBe(6);
    expect(entry.carbG).toBe(90);
  });

  it("converts a gram amount to a quantity via base_grams (33 g on base_grams 50 -> 0.66 staple)", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceGram) as unknown as FoodDictionaryRepository;

    const entry = await logFoodEntryFromDictionary(dietLog, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      foodItemId: riceGram.id,
      grams: 33,
    });

    expect(entry.staple).toBeCloseTo(0.66);
  });

  it("rejects a gram-based log when the item's base_grams is null", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    await expect(
      logFoodEntryFromDictionary(dietLog, foodDictionary, {
        userId: "user-1",
        day: "2026-07-18",
        meal: "breakfast",
        foodItemId: riceBowl.id,
        grams: 33,
      }),
    ).rejects.toThrow(NullBaseGramsError);
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

  it("orders by eaten_at, not logged_at: a back-dated breakfast sorts before an earlier-logged dinner", async () => {
    await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "dinner",
      portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
      eatenAt: new Date("2026-07-18T19:00:00.000Z"),
    });
    await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
      eatenAt: new Date("2026-07-18T08:00:00.000Z"),
    });

    const dayLog = await getDayDietLog(dietLog, "user-1", "2026-07-18");

    expect(dayLog.meals.map((m) => m.meal)).toEqual(["breakfast", "dinner"]);
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

describe("updateFoodEntry", () => {
  it("updating portions recomputes nutrients (2 staple -> ~30 g carbohydrate) and clears unclassified", async () => {
    const entry = await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "snack",
      nutrients: { carbG: 5, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 20 },
    });

    const updated = await updateFoodEntry(dietLog, "user-1", entry.id, { portions: { staple: 2, meat: 0, fruit: 0, veg: 0 } });

    expect(updated?.staple).toBe(2);
    expect(updated?.carbG).toBe(30);
    expect(updated?.unclassified).toBe(false);
  });

  it("updating only meal leaves other fields unchanged", async () => {
    const entry = await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      name: "oatmeal",
      portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
    });

    const updated = await updateFoodEntry(dietLog, "user-1", entry.id, { meal: "lunch" });

    expect(updated?.meal).toBe("lunch");
    expect(updated?.name).toBe("oatmeal");
    expect(updated?.staple).toBe(1);
    expect(updated?.carbG).toBe(entry.carbG);
    expect(updated?.eatenAt).toEqual(entry.eatenAt);
  });

  it("cannot update another user's entry: reports not found and makes no change", async () => {
    const entry = await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });

    const updated = await updateFoodEntry(dietLog, "user-2", entry.id, { meal: "lunch" });

    expect(updated).toBeNull();
    const [unchanged] = await dietLog.listByDay("user-1", "2026-07-18");
    expect(unchanged?.meal).toBe("breakfast");
  });

  it("rejects an update with no updatable fields", async () => {
    const entry = await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-18", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });

    await expect(updateFoodEntry(dietLog, "user-1", entry.id, {})).rejects.toThrow(EmptyUpdateError);
  });

  it("editing the time across a day boundary moves the entry's day", async () => {
    const entry = await logManualFoodEntry(dietLog, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "dinner",
      portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
      eatenAt: new Date("2026-07-18T23:00:00.000Z"),
    });

    const updated = await updateFoodEntry(dietLog, "user-1", entry.id, { eatenAt: new Date("2026-07-19T01:00:00.000Z") });

    expect(updated?.day).toBe("2026-07-19");
    expect(updated?.eatenAt).toEqual(new Date("2026-07-19T01:00:00.000Z"));
  });
});

describe("getLoggedDays", () => {
  it("returns distinct logged days ascending, deduping multiple entries on the same day", async () => {
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-04", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-01", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-01", meal: "lunch", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-20", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });

    const days = await getLoggedDays(dietLog, "user-1", "2026-07");

    expect(days).toEqual(["2026-07-01", "2026-07-04", "2026-07-20"]);
  });

  it("excludes days from other months", async () => {
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-06-30", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-08-01", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });

    const days = await getLoggedDays(dietLog, "user-1", "2026-07");

    expect(days).toEqual([]);
  });

  it("returns an empty list for a month with no entries", async () => {
    const days = await getLoggedDays(dietLog, "user-1", "2026-07");

    expect(days).toEqual([]);
  });

  it("scopes to the requesting user, excluding another user's entries in the same month", async () => {
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-07-05", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });
    await logManualFoodEntry(dietLog, { userId: "user-2", day: "2026-07-10", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });

    const days = await getLoggedDays(dietLog, "user-1", "2026-07");

    expect(days).toEqual(["2026-07-05"]);
  });

  it("does not error for a February month", async () => {
    await logManualFoodEntry(dietLog, { userId: "user-1", day: "2026-02-14", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } });

    const days = await getLoggedDays(dietLog, "user-1", "2026-02");

    expect(days).toEqual(["2026-02-14"]);
  });
});
