import { beforeEach, describe, expect, it } from "vitest";
import { createCustomFoodItem } from "../../../../src/contexts/health/application/create-custom-food-item";
import { favoriteFoodItem } from "../../../../src/contexts/health/application/favorite-food-item";
import { listFavoriteFoodItems } from "../../../../src/contexts/health/application/list-favorite-food-items";
import { searchFoodDictionary } from "../../../../src/contexts/health/application/search-food-dictionary";
import { unfavoriteFoodItem } from "../../../../src/contexts/health/application/unfavorite-food-item";
import type {
  CreateCustomFoodItemInput,
  FoodDictionaryRepository,
} from "../../../../src/contexts/health/domain/food-dictionary-repository";
import type { FoodItem } from "../../../../src/contexts/health/domain/food-item";

class InMemoryFoodDictionaryRepository implements FoodDictionaryRepository {
  private items = new Map<string, FoodItem>();
  private favorites = new Set<string>(); // `${userId}:${foodItemId}`
  private nextId = 1;

  seed(item: Omit<FoodItem, "id" | "createdAt"> & { id?: string }): FoodItem {
    const created: FoodItem = { id: item.id ?? String(this.nextId++), createdAt: new Date(), ...item };
    this.items.set(created.id, created);
    return created;
  }

  async search(userId: string, query: string): Promise<FoodItem[]> {
    const needle = query.toLowerCase();
    return [...this.items.values()].filter(
      (item) => (item.ownerUserId === null || item.ownerUserId === userId) && item.name.toLowerCase().includes(needle),
    );
  }

  async findById(userId: string, id: string): Promise<FoodItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    return item.ownerUserId === null || item.ownerUserId === userId ? item : null;
  }

  async createCustom(input: CreateCustomFoodItemInput): Promise<FoodItem> {
    return this.seed({ ...input, baseGrams: null });
  }

  async favorite(userId: string, foodItemId: string): Promise<void> {
    this.favorites.add(`${userId}:${foodItemId}`);
  }

  async unfavorite(userId: string, foodItemId: string): Promise<void> {
    this.favorites.delete(`${userId}:${foodItemId}`);
  }

  async listFavorites(userId: string): Promise<FoodItem[]> {
    return [...this.items.values()].filter((item) => this.favorites.has(`${userId}:${item.id}`));
  }
}

let repo: InMemoryFoodDictionaryRepository;

beforeEach(() => {
  repo = new InMemoryFoodDictionaryRepository();
});

describe("searchFoodDictionary", () => {
  it("excludes non-matching items and returns items matching a name substring", async () => {
    repo.seed({ ownerUserId: null, name: "香蕉/1根", carbG: 30, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 120, staple: 0, meat: 0, fruit: 2, veg: 0, baseGrams: null });
    repo.seed({ ownerUserId: null, name: "飯/1碗", carbG: 60, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 240, staple: 4, meat: 0, fruit: 0, veg: 0, baseGrams: null });

    const results = await searchFoodDictionary(repo, "user-1", "香蕉");

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("香蕉/1根");
  });

  it("returns an empty result set when nothing matches", async () => {
    repo.seed({ ownerUserId: null, name: "飯/1碗", carbG: 60, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 240, staple: 4, meat: 0, fruit: 0, veg: 0, baseGrams: null });

    const results = await searchFoodDictionary(repo, "user-1", "no-such-food");

    expect(results).toEqual([]);
  });

  it("returns shared items and the searching user's own custom items, excluding another user's custom items", async () => {
    repo.seed({ ownerUserId: null, name: "自訂菜/1份", carbG: 10, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 40, staple: 0, meat: 0, fruit: 0, veg: 1, baseGrams: null });
    await createCustomFoodItem(repo, {
      ownerUserId: "user-1",
      name: "自訂菜/私房",
      carbG: 5,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 20,
      staple: 0,
      meat: 0,
      fruit: 0,
      veg: 1,
    });

    const asOwner = await searchFoodDictionary(repo, "user-1", "自訂菜");
    const asOtherUser = await searchFoodDictionary(repo, "user-2", "自訂菜");

    expect(asOwner.map((i) => i.name)).toEqual(expect.arrayContaining(["自訂菜/1份", "自訂菜/私房"]));
    expect(asOtherUser.map((i) => i.name)).toEqual(["自訂菜/1份"]);
  });
});

describe("createCustomFoodItem", () => {
  it("creates an item private to its owner: it appears in the owner's search but not another user's", async () => {
    await createCustomFoodItem(repo, {
      ownerUserId: "user-A",
      name: "手工餅乾/1片",
      carbG: 12,
      proteinG: 1,
      fatG: 3,
      sugarG: 8,
      fiberG: 0,
      kcal: 90,
      staple: 0,
      meat: 0,
      fruit: 0,
      veg: 0,
    });

    const forOwner = await searchFoodDictionary(repo, "user-A", "手工餅乾");
    const forOther = await searchFoodDictionary(repo, "user-B", "手工餅乾");

    expect(forOwner).toHaveLength(1);
    expect(forOther).toHaveLength(0);
  });
});

describe("favoriteFoodItem / unfavoriteFoodItem / listFavoriteFoodItems", () => {
  it("marks an item as a favorite and lists it", async () => {
    const item = repo.seed({ ownerUserId: null, name: "豆漿/1杯", carbG: 8, proteinG: 7, fatG: 4, sugarG: 4, fiberG: 0, kcal: 100, staple: 0, meat: 1, fruit: 0, veg: 0, baseGrams: null });

    await favoriteFoodItem(repo, "user-1", item.id);
    const favorites = await listFavoriteFoodItems(repo, "user-1");

    expect(favorites.map((f) => f.id)).toEqual([item.id]);
  });

  it("unmarking a favorite removes it from the list", async () => {
    const item = repo.seed({ ownerUserId: null, name: "豆漿/1杯", carbG: 8, proteinG: 7, fatG: 4, sugarG: 4, fiberG: 0, kcal: 100, staple: 0, meat: 1, fruit: 0, veg: 0, baseGrams: null });
    await favoriteFoodItem(repo, "user-1", item.id);

    await unfavoriteFoodItem(repo, "user-1", item.id);
    const favorites = await listFavoriteFoodItems(repo, "user-1");

    expect(favorites).toEqual([]);
  });

  it("does not let a user favorite another user's private custom item", async () => {
    const foreign = await createCustomFoodItem(repo, {
      ownerUserId: "user-A",
      name: "私房菜/1份",
      carbG: 5,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 20,
      staple: 0,
      meat: 0,
      fruit: 0,
      veg: 1,
    });

    await expect(favoriteFoodItem(repo, "user-B", foreign.id)).rejects.toThrow();
    expect(await listFavoriteFoodItems(repo, "user-B")).toEqual([]);
  });
});
