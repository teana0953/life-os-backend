import { beforeEach, describe, expect, it } from "vitest";
import { createMeal } from "../../../../src/contexts/health/application/create-meal";
import { deleteMeal } from "../../../../src/contexts/health/application/delete-meal";
import { deleteMealItem } from "../../../../src/contexts/health/application/delete-meal-item";
import { getDayMeals } from "../../../../src/contexts/health/application/get-day-meals";
import { getLoggedDays } from "../../../../src/contexts/health/application/get-logged-days";
import { EmptyUpdateError, updateMealItem } from "../../../../src/contexts/health/application/update-meal-item";
import { updateMealTime } from "../../../../src/contexts/health/application/update-meal-time";
import { portionsToNutrients } from "../../../../src/contexts/health/domain/conversion";
import type { FoodDictionaryRepository } from "../../../../src/contexts/health/domain/food-dictionary-repository";
import type { FoodItem } from "../../../../src/contexts/health/domain/food-item";
import type { MealEntry, MealItem, MealSummary } from "../../../../src/contexts/health/domain/meal-entry";
import type {
  CreateMealItemInput,
  MealRepository,
  UpdateMealItemPatch,
  UpsertMealWithItemsInput,
} from "../../../../src/contexts/health/domain/meal-repository";
import { gramsToQuantity, NullBaseGramsError } from "../../../../src/contexts/health/domain/quantity";

type StoredMeal = MealSummary & { items: MealItem[] };

class InMemoryMealRepository implements MealRepository {
  meals: StoredMeal[] = [];
  private nextMealId = 1;
  private nextItemId = 1;

  async upsertMealWithItems(input: UpsertMealWithItemsInput): Promise<MealEntry> {
    let meal = this.meals.find((m) => m.userId === input.userId && m.day === input.day && m.meal === input.meal);
    if (!meal) {
      meal = {
        id: `meal-${this.nextMealId++}`,
        userId: input.userId,
        day: input.day,
        meal: input.meal,
        time: input.time ?? new Date(),
        createdAt: new Date(),
        items: [],
      };
      this.meals.push(meal);
    }
    for (const item of input.items) {
      meal.items.push(this.toStoredItem(meal.id, item));
    }
    return meal;
  }

  private toStoredItem(mealEntryId: string, item: CreateMealItemInput): MealItem {
    return { id: `item-${this.nextItemId++}`, mealEntryId, createdAt: new Date(), ...item };
  }

  async listMealsByDay(userId: string, day: string): Promise<MealEntry[]> {
    return this.meals.filter((m) => m.userId === userId && m.day === day);
  }

  async listLoggedDays(userId: string, month: string): Promise<string[]> {
    const days = new Set(this.meals.filter((m) => m.userId === userId && m.day.startsWith(month)).map((m) => m.day));
    return [...days].sort();
  }

  async updateMealTime(userId: string, mealId: string, time: Date): Promise<MealSummary | null> {
    const meal = this.meals.find((m) => m.userId === userId && m.id === mealId);
    if (!meal) return null;
    meal.time = time;
    return meal;
  }

  async deleteMeal(userId: string, mealId: string): Promise<boolean> {
    const idx = this.meals.findIndex((m) => m.userId === userId && m.id === mealId);
    if (idx === -1) return false;
    this.meals.splice(idx, 1);
    return true;
  }

  async updateItem(userId: string, itemId: string, patch: UpdateMealItemPatch): Promise<MealItem | null> {
    const meal = this.meals.find((m) => m.userId === userId && m.items.some((i) => i.id === itemId));
    if (!meal) return null;
    const item = meal.items.find((i) => i.id === itemId);
    if (!item) return null;

    if (patch.quantity !== undefined) {
      item.quantity = patch.quantity;
    } else if (patch.grams !== undefined) {
      item.quantity = gramsToQuantity(patch.grams, item.baseGrams);
    }
    if (patch.portions !== undefined) {
      const nutrients = portionsToNutrients(patch.portions);
      item.unclassified = false;
      Object.assign(item, nutrients, patch.portions);
    }
    return item;
  }

  async deleteItem(userId: string, itemId: string): Promise<boolean> {
    const meal = this.meals.find((m) => m.userId === userId && m.items.some((i) => i.id === itemId));
    if (!meal) return false;
    const idx = meal.items.findIndex((i) => i.id === itemId);
    meal.items.splice(idx, 1);
    return true;
  }
}

class StubFoodDictionaryRepository implements Pick<FoodDictionaryRepository, "findById"> {
  constructor(private readonly item: FoodItem) {}
  async findById(userId: string, id: string): Promise<FoodItem | null> {
    if (id !== this.item.id) return null;
    return this.item.ownerUserId === null || this.item.ownerUserId === userId ? this.item : null;
  }
}

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

let meals: InMemoryMealRepository;

beforeEach(() => {
  meals = new InMemoryMealRepository();
});

describe("createMeal", () => {
  it("creates one meal with several items in a single call", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "lunch",
      time: new Date("2026-07-18T12:00:00.000Z"),
      items: [
        { foodItemId: riceBowl.id },
        { portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } },
        { nutrients: { carbG: 5, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 20 } },
      ],
    });

    expect(created.meal).toBe("lunch");
    expect(created.items).toHaveLength(3);
    expect((await meals.listMealsByDay("user-1", "2026-07-18"))).toHaveLength(1);
  });

  it("appending to an existing meal reuses it instead of creating a duplicate", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });

    const dayMeals = await meals.listMealsByDay("user-1", "2026-07-18");
    expect(dayMeals).toHaveLength(1);
    expect(dayMeals[0]?.items).toHaveLength(2);
  });

  it("stores a dictionary item's per-unit values with quantity, not pre-multiplied (1.5x -> per-unit 4 staple, quantity 1.5)", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id, quantity: 1.5 }],
    });

    const item = created.items[0];
    expect(item?.staple).toBe(4);
    expect(item?.carbG).toBe(60);
    expect(item?.quantity).toBe(1.5);
    expect(item?.source).toBe("dict");
  });

  it("defaults a dictionary item's quantity to 1", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });

    expect(created.items[0]?.quantity).toBe(1);
  });

  it("converts a gram amount to quantity via base_grams, leaving per-unit values unchanged (33g / 50 -> 0.66)", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceGram) as unknown as FoodDictionaryRepository;

    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceGram.id, grams: 33 }],
    });

    const item = created.items[0];
    expect(item?.staple).toBe(1);
    expect(item?.quantity).toBeCloseTo(0.66);
    expect(item?.baseGrams).toBe(50);
  });

  it("rejects a gram amount when the dictionary item has no base_grams", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    await expect(
      createMeal(meals, foodDictionary, {
        userId: "user-1",
        day: "2026-07-18",
        meal: "breakfast",
        items: [{ foodItemId: riceBowl.id, grams: 33 }],
      }),
    ).rejects.toThrow(NullBaseGramsError);
  });

  it("stores a manual item from portions with derived per-unit nutrients, classified, quantity 1", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ portions: { staple: 2, meat: 0, fruit: 0, veg: 0 } }],
    });

    const item = created.items[0];
    expect(item?.staple).toBe(2);
    expect(item?.carbG).toBe(30);
    expect(item?.unclassified).toBe(false);
    expect(item?.quantity).toBe(1);
    expect(item?.source).toBe("manual");
  });

  it("stores a manual nutrient-only item as unclassified with zero portions", async () => {
    const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "snack",
      items: [{ nutrients: { carbG: 20, proteinG: 10, fatG: 5, sugarG: 2, fiberG: 1, kcal: 200 } }],
    });

    const item = created.items[0];
    expect(item?.unclassified).toBe(true);
    expect(item?.staple).toBe(0);
    expect(item?.kcal).toBe(200);
  });
});

describe("getDayMeals", () => {
  const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

  it("orders meals by time", async () => {
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "dinner",
      time: new Date("2026-07-18T19:00:00.000Z"),
      items: [{ portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }],
    });
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      time: new Date("2026-07-18T08:00:00.000Z"),
      items: [{ portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }],
    });

    const dayLog = await getDayMeals(meals, "user-1", "2026-07-18");

    expect(dayLog.meals.map((m) => m.meal)).toEqual(["breakfast", "dinner"]);
  });

  it("sums consumed (per-unit x quantity) across every meal's items into the day totals", async () => {
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id, quantity: 1.5 }], // per-unit 4 staple/60 carb -> consumed 6 staple/90 carb
    });
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "lunch",
      items: [{ portions: { staple: 0, meat: 1, fruit: 0, veg: 0 } }], // consumed 1 meat
    });

    const dayLog = await getDayMeals(meals, "user-1", "2026-07-18");

    expect(dayLog.totals.portions.staple).toBe(6);
    expect(dayLog.totals.portions.meat).toBe(1);
    expect(dayLog.totals.nutrients.carbG).toBe(90);
  });

  it("an unclassified item adds nutrients but zero portions to the totals", async () => {
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "snack",
      items: [{ nutrients: { carbG: 5, proteinG: 3, fatG: 1, sugarG: 0, fiberG: 0, kcal: 50 } }],
    });

    const dayLog = await getDayMeals(meals, "user-1", "2026-07-18");

    expect(dayLog.totals.nutrients.kcal).toBe(50);
    expect(dayLog.totals.portions.staple).toBe(0);
    expect(dayLog.totals.portions.meat).toBe(0);
  });

  it("exposes each item's per-unit values, quantity, and derived consumed amount", async () => {
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id, quantity: 2 }],
    });

    const dayLog = await getDayMeals(meals, "user-1", "2026-07-18");
    const item = dayLog.meals[0]?.items[0];

    expect(item?.staple).toBe(4); // per-unit
    expect(item?.quantity).toBe(2);
    expect(item?.consumed.staple).toBe(8); // per-unit x quantity
  });
});

describe("updateMealItem", () => {
  const foodDictionary = new StubFoodDictionaryRepository(riceGram) as unknown as FoodDictionaryRepository;

  it("a quantity update sets only quantity, leaving per-unit values untouched", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceGram.id }],
    });
    const itemId = created.items[0]!.id;

    const updated = await updateMealItem(meals, "user-1", itemId, { quantity: 2 });

    expect(updated?.quantity).toBe(2);
    expect(updated?.staple).toBe(1); // per-unit unchanged, no double-scale
  });

  it("a gram update sets quantity = grams / base_grams, leaving per-unit values untouched", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceGram.id }],
    });
    const itemId = created.items[0]!.id;

    const updated = await updateMealItem(meals, "user-1", itemId, { grams: 33 });

    expect(updated?.quantity).toBeCloseTo(0.66);
    expect(updated?.staple).toBe(1);
  });

  it("rejects a gram update when the item has no base_grams", async () => {
    const dict = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;
    const created = await createMeal(meals, dict, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });
    const itemId = created.items[0]!.id;

    await expect(updateMealItem(meals, "user-1", itemId, { grams: 33 })).rejects.toThrow(NullBaseGramsError);
  });

  it("a portions update recomputes per-unit nutrients and marks classified, leaving quantity untouched", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "snack",
      items: [{ nutrients: { carbG: 5, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 20 } }],
    });
    const itemId = created.items[0]!.id;

    const updated = await updateMealItem(meals, "user-1", itemId, { portions: { staple: 2, meat: 0, fruit: 0, veg: 0 } });

    expect(updated?.staple).toBe(2);
    expect(updated?.carbG).toBe(30);
    expect(updated?.unclassified).toBe(false);
    expect(updated?.quantity).toBe(1);
  });

  it("rejects an empty patch", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceGram.id }],
    });
    const itemId = created.items[0]!.id;

    await expect(updateMealItem(meals, "user-1", itemId, {})).rejects.toThrow(EmptyUpdateError);
  });

  it("cannot update another user's item: returns null and makes no change", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceGram.id }],
    });
    const itemId = created.items[0]!.id;

    const updated = await updateMealItem(meals, "user-2", itemId, { quantity: 3 });

    expect(updated).toBeNull();
    const [unchanged] = (await meals.listMealsByDay("user-1", "2026-07-18"))[0]!.items;
    expect(unchanged?.quantity).toBe(1);
  });
});

describe("deleteMealItem", () => {
  const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

  it("removes the item from its meal", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });
    const itemId = created.items[0]!.id;

    const deleted = await deleteMealItem(meals, "user-1", itemId);

    expect(deleted).toBe(true);
    expect((await meals.listMealsByDay("user-1", "2026-07-18"))[0]?.items).toEqual([]);
  });

  it("does not delete another user's item", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });
    const itemId = created.items[0]!.id;

    const deleted = await deleteMealItem(meals, "user-2", itemId);

    expect(deleted).toBe(false);
    expect((await meals.listMealsByDay("user-1", "2026-07-18"))[0]?.items).toHaveLength(1);
  });
});

describe("updateMealTime", () => {
  const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

  it("updates the meal's time without moving its day", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "dinner",
      time: new Date("2026-07-18T19:00:00.000Z"),
      items: [{ foodItemId: riceBowl.id }],
    });

    const updated = await updateMealTime(meals, "user-1", created.id, new Date("2026-07-19T01:00:00.000Z"));

    expect(updated?.time).toEqual(new Date("2026-07-19T01:00:00.000Z"));
    expect(updated?.day).toBe("2026-07-18");
  });

  it("cannot update another user's meal", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "dinner",
      items: [{ foodItemId: riceBowl.id }],
    });

    const updated = await updateMealTime(meals, "user-2", created.id, new Date("2026-07-19T01:00:00.000Z"));

    expect(updated).toBeNull();
  });
});

describe("deleteMeal", () => {
  const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

  it("deletes the meal and (cascade) its items", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });

    const deleted = await deleteMeal(meals, "user-1", created.id);

    expect(deleted).toBe(true);
    expect(await meals.listMealsByDay("user-1", "2026-07-18")).toEqual([]);
  });

  it("cannot delete another user's meal", async () => {
    const created = await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-18",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });

    const deleted = await deleteMeal(meals, "user-2", created.id);

    expect(deleted).toBe(false);
    expect(await meals.listMealsByDay("user-1", "2026-07-18")).toHaveLength(1);
  });
});

describe("getLoggedDays", () => {
  const foodDictionary = new StubFoodDictionaryRepository(riceBowl) as unknown as FoodDictionaryRepository;

  it("returns distinct logged days ascending", async () => {
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-04",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-01",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-20",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });

    const days = await getLoggedDays(meals, "user-1", "2026-07");

    expect(days).toEqual(["2026-07-01", "2026-07-04", "2026-07-20"]);
  });

  it("excludes days from other months", async () => {
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-06-30",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });

    const days = await getLoggedDays(meals, "user-1", "2026-07");

    expect(days).toEqual([]);
  });

  it("scopes to the requesting user", async () => {
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-07-05",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });
    await createMeal(meals, foodDictionary, {
      userId: "user-2",
      day: "2026-07-10",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });

    const days = await getLoggedDays(meals, "user-1", "2026-07");

    expect(days).toEqual(["2026-07-05"]);
  });

  it("does not error for a February month", async () => {
    await createMeal(meals, foodDictionary, {
      userId: "user-1",
      day: "2026-02-14",
      meal: "breakfast",
      items: [{ foodItemId: riceBowl.id }],
    });

    const days = await getLoggedDays(meals, "user-1", "2026-02");

    expect(days).toEqual(["2026-02-14"]);
  });
});
