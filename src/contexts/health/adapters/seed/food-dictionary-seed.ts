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
  baseAmount: number | null;
  measureUnit: "g" | "ml" | null;
}

/**
 * Matches a bare gram amount in the unit segment after the row name's `/`
 * (e.g. `/50g`, `/30g`, `/140克`), per design.md D4/G2. Both the ASCII `g` and
 * the Chinese `克` mean grams. The match is anchored to the number right after
 * `/`, so a `克` inside a brand name (e.g. `星巴克拿鐵/1杯`) is not mistaken for a
 * unit.
 */
const BASE_GRAMS_PATTERN = /\/\s*(\d+(?:\.\d+)?)\s*(?:g\b|克)/;

/**
 * Matches a bare millilitre amount in the unit segment after the row name's
 * `/` (e.g. `/240mL`, `/100ml`, `/ 315ml`), per design.md G2. `mL`/`ml`,
 * `毫升`, and `cc` all mean millilitres. Anchored to the number right after
 * `/`, exactly like the gram pattern, so an mL-looking substring earlier in
 * the name (e.g. `喝的桂格燕麥飲290mL/1瓶`, whose unit token is `/1瓶`) is never
 * mistaken for the unit.
 */
const BASE_ML_PATTERN = /\/\s*(\d+(?:\.\d+)?)\s*(?:ml\b|毫升|cc\b)/i;

/** Parses the base measure (amount + unit) from the row name's unit token; null when the unit is a household measure (D4, G2). */
function parseBaseMeasure(name: string): { amount: number; unit: "g" | "ml" } | null {
  const gramMatch = BASE_GRAMS_PATTERN.exec(name);
  if (gramMatch) return { amount: Number(gramMatch[1]), unit: "g" };

  const mlMatch = BASE_ML_PATTERN.exec(name);
  if (mlMatch) return { amount: Number(mlMatch[1]), unit: "ml" };

  return null;
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

  const measure = parseBaseMeasure(row.name);
  return {
    name: row.name,
    ...nutrients,
    sugarG,
    ...portions,
    baseAmount: measure?.amount ?? null,
    measureUnit: measure?.unit ?? null,
  };
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
      baseAmount: item.baseAmount === null ? null : String(item.baseAmount),
      measureUnit: item.measureUnit,
    };
  });
  if (values.length === 0) return;
  await db.insert(foodItem).values(values);
}
