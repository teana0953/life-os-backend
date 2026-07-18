import { describe, expect, it } from "vitest";
import { gramsToQuantity, NullBaseGramsError, scaleByQuantity } from "../../../../src/contexts/health/domain/quantity";

describe("scaleByQuantity", () => {
  it("scales both nutrients and portions by the given quantity", () => {
    const item = {
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
    };

    const scaled = scaleByQuantity(item, 1.5);

    expect(scaled.staple).toBe(6);
    expect(scaled.carbG).toBe(90);
  });

  it("quantity 1 reproduces the item's values unchanged", () => {
    const item = { carbG: 30, proteinG: 0, fatG: 0, sugarG: 30, fiberG: 0, kcal: 120, staple: 0, meat: 0, fruit: 2, veg: 0 };

    const scaled = scaleByQuantity(item, 1);

    expect(scaled).toEqual(item);
  });
});

describe("gramsToQuantity", () => {
  it("converts grams to a quantity via base_grams (33 / 50 = 0.66)", () => {
    expect(gramsToQuantity(33, 50)).toBeCloseTo(0.66);
  });

  it("throws NullBaseGramsError when base_grams is null", () => {
    expect(() => gramsToQuantity(33, null)).toThrow(NullBaseGramsError);
  });
});
