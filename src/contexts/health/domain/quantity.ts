/**
 * Pure quantity scaling and gram-to-quantity conversion (D1, D2 in design.md).
 * No Workers runtime, no I/O.
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

/** Thrown when a gram amount is given for an item whose base_grams is null (D2). */
export class NullBaseGramsError extends Error {}

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

/** Converts a gram amount to a quantity via the item's base_grams; throws when base_grams is null (D2). */
export function gramsToQuantity(grams: number, baseGrams: number | null): number {
  if (baseGrams === null) {
    throw new NullBaseGramsError("item has no base_grams defined");
  }
  return grams / baseGrams;
}
