import { describe, expect, it } from "vitest";
import { seedRowToFoodItem } from "../../../../../src/contexts/health/adapters/seed/food-dictionary-seed";

describe("seedRowToFoodItem", () => {
  it("converts a 主食 1 份 row to ~15 g carbohydrate, storing both the portion and the derived nutrient", () => {
    const item = seedRowToFoodItem({ id: 1, name: "飯/1碗", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(item.staple).toBe(1);
    expect(item.carbG).toBeCloseTo(15);
  });

  it("converts a 肉類 1 份 row to 7 g protein", () => {
    const item = seedRowToFoodItem({ id: 2, name: "熟肉(雞豬牛羊魚)/30g", staple: 0, meat: 1, fruit: 0, veg: 0 });

    expect(item.meat).toBe(1);
    expect(item.proteinG).toBe(7);
  });

  it("derives sugar_g for a fruit row equal to the fruit-derived carbohydrate (subset of carb_g, per D6)", () => {
    const item = seedRowToFoodItem({ id: 3, name: "香蕉/1根", staple: 0, meat: 0, fruit: 2, veg: 0 });

    expect(item.fruit).toBe(2);
    expect(item.carbG).toBe(30);
    expect(item.sugarG).toBe(30);
    // sugar is a subset of carb, so it must not double-count into kcal.
    expect(item.kcal).toBe(item.carbG * 4 + item.proteinG * 4 + item.fatG * 9);
  });

  it("does not derive sugar_g for a non-fruit row", () => {
    const item = seedRowToFoodItem({ id: 4, name: "蔬菜/1份", staple: 0, meat: 0, fruit: 0, veg: 1 });

    expect(item.sugarG).toBe(0);
  });

  it("backfills base_grams from a bare gram unit token in the name", () => {
    const item = seedRowToFoodItem({ id: 5, name: "飯/50g", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(item.baseGrams).toBe(50);
  });

  it("backfills base_grams for a parenthesized gram unit", () => {
    const item = seedRowToFoodItem({ id: 6, name: "熟肉(雞豬牛羊魚)/30g", staple: 0, meat: 1, fruit: 0, veg: 0 });

    expect(item.baseGrams).toBe(30);
  });

  it("leaves base_grams null for a household-unit row", () => {
    const item = seedRowToFoodItem({ id: 7, name: "飯/1碗", staple: 4, meat: 0, fruit: 0, veg: 0 });

    expect(item.baseGrams).toBeNull();
  });

  it("leaves base_grams null for other household units (根, 掌心大, 湯匙)", () => {
    expect(seedRowToFoodItem({ id: 8, name: "香蕉/1根", staple: 0, meat: 0, fruit: 2, veg: 0 }).baseGrams).toBeNull();
    expect(seedRowToFoodItem({ id: 9, name: "肉包掌心大/1個", staple: 3, meat: 1, fruit: 0, veg: 0 }).baseGrams).toBeNull();
    expect(seedRowToFoodItem({ id: 10, name: "麥片/2湯匙", staple: 1, meat: 0, fruit: 0, veg: 0 }).baseGrams).toBeNull();
  });

  it("backfills base_grams from a Chinese 克 gram unit", () => {
    expect(seedRowToFoodItem({ id: 11, name: "雞胸肉水餃/140克", staple: 2, meat: 1.5, fruit: 0, veg: 0 }).baseGrams).toBe(140);
    expect(seedRowToFoodItem({ id: 12, name: "蓮藕/100克", staple: 1, meat: 0, fruit: 0, veg: 0 }).baseGrams).toBe(100);
  });

  it("does not mistake a 克 inside a brand name for a gram unit", () => {
    expect(seedRowToFoodItem({ id: 13, name: "星巴克拿鐵(大杯)/1杯", staple: 0, meat: 3, fruit: 0, veg: 0 }).baseGrams).toBeNull();
  });
});
