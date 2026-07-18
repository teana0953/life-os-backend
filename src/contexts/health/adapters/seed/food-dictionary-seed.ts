import type { Db } from "../../../../shared/db/client";
import { foodItem } from "../../../../shared/db/schema";
import { portionsToNutrients } from "../../domain/conversion";
import { FOOD_SEED_ROWS } from "./food-dictionary-seed-data";

/** One row of the user's household-unit food -> portion reference table. */
export interface FoodSeedRow {
  id: number;
  name: string;
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
}

export interface SeedFoodItem {
  name: string;
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
  baseGrams: number | null;
}

/** Matches a bare gram amount in the unit segment after the row name's `/` (e.g. `/50g`, `/30g`), per design.md D4. */
const BASE_GRAMS_PATTERN = /\/\s*(\d+(?:\.\d+)?)\s*g\b/;

/** Parses `base_grams` from the row name's unit token; null when the unit is a household measure (D4). */
function parseBaseGrams(name: string): number | null {
  const match = BASE_GRAMS_PATTERN.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Converts one seed row's portions to a shared food_item's atomic nutrients
 * via the D2 conversion module, per design.md D3. `sugar_g` is a subset of
 * `carb_g` (nutrition-label convention, D6): for a row carrying a fruit
 * portion, seeded sugar_g is set equal to the fruit-derived carbohydrate,
 * since fruit-as-sugar is the source table's convention; this does not change
 * kcal because sugar is already counted once inside carb_g.
 */
export function seedRowToFoodItem(row: FoodSeedRow): SeedFoodItem {
  const portions = { staple: row.staple, meat: row.meat, fruit: row.fruit, veg: row.veg };
  const nutrients = portionsToNutrients(portions);
  const sugarG = row.fruit > 0 ? row.fruit * 15 : 0;

  return { name: row.name, ...nutrients, sugarG, ...portions, baseGrams: parseBaseGrams(row.name) };
}

/**
 * The shared dictionary is seeded from the user's full 271-row food -> portion
 * reference table, exported from their Google Drive sheet into
 * `./food-dictionary-seed-data.ts`. Each row's atomic nutrients are derived at
 * seed time by `seedRowToFoodItem`; to refresh, regenerate the data file from
 * the sheet — `seedFoodDictionary` and `seedRowToFoodItem` need no changes.
 */
export const SEED_ROWS: FoodSeedRow[] = FOOD_SEED_ROWS;

/** Inserts the seed rows as shared (owner_user_id = null) food_item rows. */
export async function seedFoodDictionary(db: Db, rows: FoodSeedRow[] = SEED_ROWS): Promise<void> {
  const values = rows.map((row) => {
    const item = seedRowToFoodItem(row);
    return {
      ownerUserId: null,
      name: item.name,
      carbG: String(item.carbG),
      proteinG: String(item.proteinG),
      fatG: String(item.fatG),
      sugarG: String(item.sugarG),
      fiberG: String(item.fiberG),
      kcal: String(item.kcal),
      staple: String(item.staple),
      meat: String(item.meat),
      fruit: String(item.fruit),
      veg: String(item.veg),
      baseGrams: item.baseGrams === null ? null : String(item.baseGrams),
    };
  });
  if (values.length === 0) return;
  await db.insert(foodItem).values(values);
}
