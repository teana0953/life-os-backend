/**
 * Pure quantity scaling and measure-to-quantity conversion (D1, D2 in design.md,
 * generalised to a measure amount + unit by G3). No Workers runtime, no I/O.
 */

export interface Scalable {
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal: number;
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
}

/** Thrown when a measure amount is given for an item whose base_amount is null (D2, G3). */
export class NullBaseMeasureError extends Error {}

/** Scales both the atomic nutrients and the food-group portions by `quantity` (D1). */
export function scaleByQuantity<T extends Scalable>(item: T, quantity: number): Scalable {
  return {
    carbG: item.carbG * quantity,
    proteinG: item.proteinG * quantity,
    fatG: item.fatG * quantity,
    sugarG: item.sugarG * quantity,
    fiberG: item.fiberG * quantity,
    kcal: item.kcal * quantity,
    staple: item.staple * quantity,
    meat: item.meat * quantity,
    fruit: item.fruit * quantity,
    veg: item.veg * quantity,
  };
}

/** Converts a measure amount to a quantity via the item's base_amount; throws when base_amount is null (D2, G3). */
export function measureToQuantity(measure: number, baseAmount: number | null): number {
  if (baseAmount === null) {
    throw new NullBaseMeasureError("item has no base_amount defined");
  }
  return measure / baseAmount;
}
