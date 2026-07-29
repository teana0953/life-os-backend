import { beforeEach, describe, expect, it } from "vitest";
import { createCustomFoodItem } from "../../../../src/contexts/health/application/create-custom-food-item";
import { createSharedFoodItem, InvalidFoodItemError } from "../../../../src/contexts/health/application/create-shared-food-item";
import { favoriteFoodItem } from "../../../../src/contexts/health/application/favorite-food-item";
import { listFavoriteFoodItems } from "../../../../src/contexts/health/application/list-favorite-food-items";
import { searchFoodDictionary } from "../../../../src/contexts/health/application/search-food-dictionary";
import { unfavoriteFoodItem } from "../../../../src/contexts/health/application/unfavorite-food-item";
import { updateSharedFoodItem } from "../../../../src/contexts/health/application/update-shared-food-item";
import type {
  CreateCustomFoodItemInput,
  CreateSharedFoodItemInput,
  FoodDictionaryRepository,
  UpdateSharedFoodItemPatch,
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
    return this.seed({ ...input, baseAmount: null, measureUnit: null });
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

  async findSharedById(id: string): Promise<FoodItem | null> {
    const item = this.items.get(id);
    return item && item.ownerUserId === null ? item : null;
  }

  async createShared(input: CreateSharedFoodItemInput): Promise<FoodItem> {
    return this.seed({ ...input, ownerUserId: null });
  }

  async updateSharedById(id: string, patch: UpdateSharedFoodItemPatch): Promise<FoodItem | null> {
    const item = this.items.get(id);
    if (!item || item.ownerUserId !== null) return null;
    const updated: FoodItem = { ...item };
    if ("name" in patch && patch.name !== undefined) updated.name = patch.name;
    if ("carbG" in patch && patch.carbG !== undefined) updated.carbG = patch.carbG;
    if ("proteinG" in patch && patch.proteinG !== undefined) updated.proteinG = patch.proteinG;
    if ("fatG" in patch && patch.fatG !== undefined) updated.fatG = patch.fatG;
    if ("sugarG" in patch && patch.sugarG !== undefined) updated.sugarG = patch.sugarG;
    if ("fiberG" in patch && patch.fiberG !== undefined) updated.fiberG = patch.fiberG;
    if ("kcal" in patch && patch.kcal !== undefined) updated.kcal = patch.kcal;
    if ("staple" in patch && patch.staple !== undefined) updated.staple = patch.staple;
    if ("meat" in patch && patch.meat !== undefined) updated.meat = patch.meat;
    if ("fruit" in patch && patch.fruit !== undefined) updated.fruit = patch.fruit;
    if ("veg" in patch && patch.veg !== undefined) updated.veg = patch.veg;
    if ("baseAmount" in patch) updated.baseAmount = patch.baseAmount ?? null;
    if ("measureUnit" in patch) updated.measureUnit = patch.measureUnit ?? null;
    this.items.set(id, updated);
    return updated;
  }
}

let repo: InMemoryFoodDictionaryRepository;

beforeEach(() => {
  repo = new InMemoryFoodDictionaryRepository();
});

describe("searchFoodDictionary", () => {
  it("excludes non-matching items and returns items matching a name substring", async () => {
    repo.seed({ ownerUserId: null, name: "香蕉/1根", carbG: 30, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 120, staple: 0, meat: 0, fruit: 2, veg: 0, baseAmount: null, measureUnit: null });
    repo.seed({ ownerUserId: null, name: "飯/1碗", carbG: 60, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 240, staple: 4, meat: 0, fruit: 0, veg: 0, baseAmount: null, measureUnit: null });

    const results = await searchFoodDictionary(repo, "user-1", "香蕉");

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("香蕉/1根");
  });

  it("returns an empty result set when nothing matches", async () => {
    repo.seed({ ownerUserId: null, name: "飯/1碗", carbG: 60, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 240, staple: 4, meat: 0, fruit: 0, veg: 0, baseAmount: null, measureUnit: null });

    const results = await searchFoodDictionary(repo, "user-1", "no-such-food");

    expect(results).toEqual([]);
  });

  it("returns shared items and the searching user's own custom items, excluding another user's custom items", async () => {
    repo.seed({ ownerUserId: null, name: "自訂菜/1份", carbG: 10, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 40, staple: 0, meat: 0, fruit: 0, veg: 1, baseAmount: null, measureUnit: null });
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
    const item = repo.seed({ ownerUserId: null, name: "豆漿/1杯", carbG: 8, proteinG: 7, fatG: 4, sugarG: 4, fiberG: 0, kcal: 100, staple: 0, meat: 1, fruit: 0, veg: 0, baseAmount: null, measureUnit: null });

    await favoriteFoodItem(repo, "user-1", item.id);
    const favorites = await listFavoriteFoodItems(repo, "user-1");

    expect(favorites.map((f) => f.id)).toEqual([item.id]);
  });

  it("unmarking a favorite removes it from the list", async () => {
    const item = repo.seed({ ownerUserId: null, name: "豆漿/1杯", carbG: 8, proteinG: 7, fatG: 4, sugarG: 4, fiberG: 0, kcal: 100, staple: 0, meat: 1, fruit: 0, veg: 0, baseAmount: null, measureUnit: null });
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

const sharedInput: CreateSharedFoodItemInput = {
  name: "白吐司/1片",
  carbG: 15,
  proteinG: 2,
  fatG: 1,
  sugarG: 1,
  fiberG: 1,
  kcal: 80,
  staple: 1,
  meat: 0,
  fruit: 0,
  veg: 0,
  baseAmount: null,
  measureUnit: null,
};

describe("createSharedFoodItem", () => {
  it("creates an item with no owner, visible to every user", async () => {
    const item = await createSharedFoodItem(repo, sharedInput);

    expect(item.ownerUserId).toBeNull();
    const results = await searchFoodDictionary(repo, "some-other-user", "白吐司");
    expect(results.map((i) => i.id)).toEqual([item.id]);
  });

  it("rejects a measure basis with only a base_amount and no measure_unit, creating nothing", async () => {
    await expect(
      createSharedFoodItem(repo, { ...sharedInput, baseAmount: 50, measureUnit: null }),
    ).rejects.toThrow(InvalidFoodItemError);

    expect(await searchFoodDictionary(repo, "user-1", "白吐司")).toEqual([]);
  });

  it("rejects a measure basis with only a measure_unit and no base_amount, creating nothing", async () => {
    await expect(
      createSharedFoodItem(repo, { ...sharedInput, baseAmount: null, measureUnit: "片" }),
    ).rejects.toThrow(InvalidFoodItemError);

    expect(await searchFoodDictionary(repo, "user-1", "白吐司")).toEqual([]);
  });
});

describe("updateSharedFoodItem", () => {
  it("changes only the supplied fields, leaving the rest intact", async () => {
    const item = repo.seed({
      ownerUserId: null,
      name: "白吐司/1片",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: null,
      measureUnit: null,
    });

    const updated = await updateSharedFoodItem(repo, item.id, { name: "全麥吐司/1片", carbG: 14 });

    expect(updated).toMatchObject({ ...item, name: "全麥吐司/1片", carbG: 14 });
  });

  it("rejects an empty patch as invalid and writes nothing", async () => {
    const item = repo.seed({ ...sharedInput, ownerUserId: null });

    await expect(updateSharedFoodItem(repo, item.id, {})).rejects.toThrow(InvalidFoodItemError);

    expect(await repo.findSharedById(item.id)).toEqual(item);
  });

  it("reports a user-owned item id as not-found (same as an unknown id)", async () => {
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

    const forOwnedItem = await updateSharedFoodItem(repo, foreign.id, { name: "改名" });
    const forUnknownId = await updateSharedFoodItem(repo, "no-such-id", { name: "改名" });

    expect(forOwnedItem).toBeNull();
    expect(forUnknownId).toBeNull();
    expect(await repo.findById("user-A", foreign.id)).toMatchObject({ name: "私房菜/1份" });
  });

  it("rejects clearing only base_amount when measure_unit would remain, leaving the item unchanged", async () => {
    const item = repo.seed({ ...sharedInput, ownerUserId: null, baseAmount: 50, measureUnit: "g" });

    await expect(updateSharedFoodItem(repo, item.id, { baseAmount: null })).rejects.toThrow(InvalidFoodItemError);

    expect(await repo.findSharedById(item.id)).toEqual(item);
  });

  it("accepts supplying both measure-basis parts together on an item that had neither", async () => {
    const item = repo.seed({ ...sharedInput, ownerUserId: null, baseAmount: null, measureUnit: null });

    const updated = await updateSharedFoodItem(repo, item.id, { baseAmount: 50, measureUnit: "g" });

    expect(updated).toMatchObject({ baseAmount: 50, measureUnit: "g" });
  });

  it("accepts clearing both measure-basis parts together on an item that had both", async () => {
    const item = repo.seed({ ...sharedInput, ownerUserId: null, baseAmount: 50, measureUnit: "g" });

    const updated = await updateSharedFoodItem(repo, item.id, { baseAmount: null, measureUnit: null });

    expect(updated).toMatchObject({ baseAmount: null, measureUnit: null });
  });
});
