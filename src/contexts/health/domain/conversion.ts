/**
 * Pure nutrient <-> portion <-> calorie conversion (Taiwan MOHW food-exchange
 * standard). No Workers runtime, no I/O — see design.md D2.
 *
 * Divisors: staple/fruit portion = carb_g / 15, meat portion = protein_g / 7,
 * veg portion = carb_g / 5. Calories are never derived from portion counts.
 */

const CARB_G_PER_STAPLE_PORTION = 15;
const PROTEIN_G_PER_MEAT_PORTION = 7;
const CARB_G_PER_FRUIT_PORTION = 15;
const CARB_G_PER_VEG_PORTION = 5;

export type PortionGroup = "staple" | "meat" | "fruit" | "veg";

export interface Portions {
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
}

export interface Macros {
  carbG: number;
  proteinG: number;
  fatG: number;
}

export interface Nutrients extends Macros {
  sugarG: number;
  fiberG: number;
  kcal: number;
}

/** Projects a gram quantity attributed to a single food group to that group's portion count. */
export function gramsToPortion(group: PortionGroup, grams: number): number {
  switch (group) {
    case "staple":
      return grams / CARB_G_PER_STAPLE_PORTION;
    case "fruit":
      return grams / CARB_G_PER_FRUIT_PORTION;
    case "veg":
      return grams / CARB_G_PER_VEG_PORTION;
    case "meat":
      return grams / PROTEIN_G_PER_MEAT_PORTION;
  }
}

/** kcal fallback formula, used only when no explicit kcal is available. */
export function kcalFromMacros(macros: Macros): number {
  return macros.carbG * 4 + macros.proteinG * 4 + macros.fatG * 9;
}

/** Explicit kcal (label/AI estimate) wins; otherwise falls back to the macro formula. */
export function resolveKcal(macros: Macros, explicitKcal?: number): number {
  return explicitKcal ?? kcalFromMacros(macros);
}

/**
 * Derives atomic nutrients from stored food-group portions (used for
 * portion-carrying writes: dictionary items and manual entries logged by
 * portion). Fat, sugar, and fiber are not estimable from portions alone and
 * are left at 0; kcal falls back to the macro formula since no label/AI kcal
 * is available when deriving from portions.
 */
export function portionsToNutrients(portions: Portions): Nutrients {
  const carbG =
    portions.staple * CARB_G_PER_STAPLE_PORTION +
    portions.fruit * CARB_G_PER_FRUIT_PORTION +
    portions.veg * CARB_G_PER_VEG_PORTION;
  const proteinG = portions.meat * PROTEIN_G_PER_MEAT_PORTION;
  const fatG = 0;
  const sugarG = 0;
  const fiberG = 0;

  return { carbG, proteinG, fatG, sugarG, fiberG, kcal: kcalFromMacros({ carbG, proteinG, fatG }) };
}
