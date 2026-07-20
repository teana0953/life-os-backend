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

  it("backfills a gram measure basis from a bare gram unit token in the name", () => {
    const item = seedRowToFoodItem({ id: 5, name: "飯/50g", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(item.baseAmount).toBe(50);
    expect(item.measureUnit).toBe("g");
  });

  it("backfills a gram measure basis for a parenthesized gram unit", () => {
    const item = seedRowToFoodItem({ id: 6, name: "熟肉(雞豬牛羊魚)/30g", staple: 0, meat: 1, fruit: 0, veg: 0 });

    expect(item.baseAmount).toBe(30);
    expect(item.measureUnit).toBe("g");
  });

  it("leaves the measure basis null for a household-unit row", () => {
    const item = seedRowToFoodItem({ id: 7, name: "飯/1碗", staple: 4, meat: 0, fruit: 0, veg: 0 });

    expect(item.baseAmount).toBeNull();
    expect(item.measureUnit).toBeNull();
  });

  it("leaves the measure basis null for other household units (根, 掌心大, 湯匙)", () => {
    const banana = seedRowToFoodItem({ id: 8, name: "香蕉/1根", staple: 0, meat: 0, fruit: 2, veg: 0 });
    const bun = seedRowToFoodItem({ id: 9, name: "肉包掌心大/1個", staple: 3, meat: 1, fruit: 0, veg: 0 });
    const oats = seedRowToFoodItem({ id: 10, name: "麥片/2湯匙", staple: 1, meat: 0, fruit: 0, veg: 0 });

    for (const item of [banana, bun, oats]) {
      expect(item.baseAmount).toBeNull();
      expect(item.measureUnit).toBeNull();
    }
  });

  it("backfills a gram measure basis from a Chinese 克 gram unit", () => {
    const dumplings = seedRowToFoodItem({ id: 11, name: "雞胸肉水餃/140克", staple: 2, meat: 1.5, fruit: 0, veg: 0 });
    const lotusRoot = seedRowToFoodItem({ id: 12, name: "蓮藕/100克", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(dumplings.baseAmount).toBe(140);
    expect(dumplings.measureUnit).toBe("g");
    expect(lotusRoot.baseAmount).toBe(100);
    expect(lotusRoot.measureUnit).toBe("g");
  });

  it("does not mistake a 克 inside a brand name for a gram unit", () => {
    const item = seedRowToFoodItem({ id: 13, name: "星巴克拿鐵(大杯)/1杯", staple: 0, meat: 3, fruit: 0, veg: 0 });

    expect(item.baseAmount).toBeNull();
    expect(item.measureUnit).toBeNull();
  });

  it("backfills a millilitre measure basis from an mL unit token", () => {
    const soymilk = seedRowToFoodItem({ id: 14, name: "無糖豆漿/240mL", staple: 0, meat: 1, fruit: 0, veg: 0 });

    expect(soymilk.baseAmount).toBe(240);
    expect(soymilk.measureUnit).toBe("ml");
  });

  it("backfills a millilitre measure basis from a lowercase ml unit token", () => {
    const beer = seedRowToFoodItem({ id: 15, name: "啤酒/100ml", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(beer.baseAmount).toBe(100);
    expect(beer.measureUnit).toBe("ml");
  });

  it("backfills a millilitre measure basis with a space before the unit token", () => {
    const tea = seedRowToFoodItem({ id: 16, name: "muji 草莓紅茶罐裝/ 315ml", staple: 0, meat: 0, fruit: 2, veg: 0 });

    expect(tea.baseAmount).toBe(315);
    expect(tea.measureUnit).toBe("ml");
  });

  it("does not mistake an mL substring inside the name for the unit when the unit token after / is a household count", () => {
    const oatDrink = seedRowToFoodItem({ id: 17, name: "喝的桂格燕麥飲290mL/1瓶", staple: 2, meat: 0, fruit: 0, veg: 0 });
    const granolaDrink = seedRowToFoodItem({ id: 18, name: "顆粒燕麥飲290mL/1瓶", staple: 2, meat: 0, fruit: 0, veg: 0 });
    const soyOatDrink = seedRowToFoodItem({ id: 19, name: "桂格豆漿燕麥飲290mL/1瓶", staple: 1, meat: 1, fruit: 0, veg: 0 });

    for (const item of [oatDrink, granolaDrink, soyOatDrink]) {
      expect(item.baseAmount).toBeNull();
      expect(item.measureUnit).toBeNull();
    }
  });

  it("the measure basis is always both-present or both-null (never one without the other)", () => {
    const rows = [
      { id: 20, name: "飯/50g", staple: 1, meat: 0, fruit: 0, veg: 0 },
      { id: 21, name: "無糖豆漿/240mL", staple: 0, meat: 1, fruit: 0, veg: 0 },
      { id: 22, name: "飯/1碗", staple: 4, meat: 0, fruit: 0, veg: 0 },
    ];

    for (const row of rows) {
      const item = seedRowToFoodItem(row);
      expect(item.baseAmount === null).toBe(item.measureUnit === null);
    }
  });
});
