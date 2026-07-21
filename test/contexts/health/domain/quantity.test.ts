import { describe, expect, it } from "vitest";
import { measureToQuantity, NullBaseMeasureError, scaleByQuantity } from "../../../../src/contexts/health/domain/quantity";

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

describe("measureToQuantity", () => {
  it("converts a gram measure to a quantity via a gram base_amount (33 / 50 = 0.66)", () => {
    expect(measureToQuantity(33, 50)).toBeCloseTo(0.66);
  });

  it("converts a millilitre measure to a quantity via an ml base_amount (120 / 240 = 0.5)", () => {
    expect(measureToQuantity(120, 240)).toBe(0.5);
  });

  it("converts a household-quantifier measure to a quantity via its base_amount (18 顆 / 9 = 2)", () => {
    expect(measureToQuantity(18, 9)).toBe(2);
  });

  it("throws NullBaseMeasureError when base_amount is null", () => {
    expect(() => measureToQuantity(33, null)).toThrow(NullBaseMeasureError);
  });
});
