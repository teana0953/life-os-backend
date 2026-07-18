import { describe, expect, it } from "vitest";
import { gramsToPortion, kcalFromMacros, portionsToNutrients, resolveKcal } from "../../../../src/contexts/health/domain/conversion";

describe("conversion", () => {
  describe("portionsToNutrients", () => {
    it("生米20g -> 1 staple: 1 staple portion is 15 g carbohydrate", () => {
      const nutrients = portionsToNutrients({ staple: 1, meat: 0, fruit: 0, veg: 0 });
      expect(nutrients.carbG).toBe(15);
    });

    it("蛋1個 -> 1 meat: 1 meat portion is 7 g protein", () => {
      const nutrients = portionsToNutrients({ staple: 0, meat: 1, fruit: 0, veg: 0 });
      expect(nutrients.proteinG).toBe(7);
    });

    it("香蕉1根 -> 2 fruit: 2 fruit portions is 30 g carbohydrate", () => {
      const nutrients = portionsToNutrients({ staple: 0, meat: 0, fruit: 2, veg: 0 });
      expect(nutrients.carbG).toBe(30);
    });

    it("1 vegetable portion is 5 g carbohydrate", () => {
      const nutrients = portionsToNutrients({ staple: 0, meat: 0, fruit: 0, veg: 1 });
      expect(nutrients.carbG).toBe(5);
    });

    it("sums carbohydrate across staple, fruit, and veg groups", () => {
      const nutrients = portionsToNutrients({ staple: 2, meat: 1, fruit: 1, veg: 1 });
      expect(nutrients.carbG).toBe(2 * 15 + 1 * 15 + 1 * 5);
      expect(nutrients.proteinG).toBe(7);
    });

    it("does not estimate fat, sugar, or fiber from portions", () => {
      const nutrients = portionsToNutrients({ staple: 2, meat: 2, fruit: 2, veg: 2 });
      expect(nutrients.fatG).toBe(0);
      expect(nutrients.sugarG).toBe(0);
      expect(nutrients.fiberG).toBe(0);
    });

    it("derives kcal from the resulting macros (fallback), never from portions directly", () => {
      const nutrients = portionsToNutrients({ staple: 1, meat: 1, fruit: 0, veg: 0 });
      expect(nutrients.kcal).toBe(kcalFromMacros({ carbG: 15, proteinG: 7, fatG: 0 }));
    });
  });

  describe("gramsToPortion", () => {
    it("7 g of protein attributed to the meat group projects to 1 meat portion", () => {
      expect(gramsToPortion("meat", 7)).toBe(1);
    });

    it("15 g of carbohydrate attributed to the staple group projects to 1 staple portion", () => {
      expect(gramsToPortion("staple", 15)).toBe(1);
    });

    it("15 g of carbohydrate attributed to the fruit group projects to 1 fruit portion", () => {
      expect(gramsToPortion("fruit", 15)).toBe(1);
    });

    it("5 g of carbohydrate attributed to the veg group projects to 1 veg portion", () => {
      expect(gramsToPortion("veg", 5)).toBe(1);
    });
  });

  describe("kcalFromMacros", () => {
    it("computes kcal as carb*4 + protein*4 + fat*9", () => {
      expect(kcalFromMacros({ carbG: 10, proteinG: 5, fatG: 2 })).toBe(10 * 4 + 5 * 4 + 2 * 9);
    });
  });

  describe("resolveKcal", () => {
    it("falls back to the macro formula when no explicit kcal is given", () => {
      const kcal = resolveKcal({ carbG: 10, proteinG: 5, fatG: 2 });
      expect(kcal).toBe(kcalFromMacros({ carbG: 10, proteinG: 5, fatG: 2 }));
    });

    it("passes through an explicit kcal instead of computing from macros", () => {
      const kcal = resolveKcal({ carbG: 10, proteinG: 5, fatG: 2 }, 500);
      expect(kcal).toBe(500);
    });
  });
});
