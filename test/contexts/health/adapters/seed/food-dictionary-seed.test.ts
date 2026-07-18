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
});
