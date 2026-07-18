import type { Db } from "../../../../shared/db/client";
import { foodItem } from "../../../../shared/db/schema";
import { portionsToNutrients } from "../../domain/conversion";

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

  return { name: row.name, ...nutrients, sugarG, ...portions };
}

/**
 * Placeholder seed data.
 *
 * design.md and tasks.md call for seeding the shared dictionary from the
 * user's 271-row food -> portion spreadsheet, said to be recorded in
 * `docs/research/chaodays-health-tracking.md`. That file (as present in this
 * repo) contains only narrative research notes about chaodays.app — it does
 * not contain the row-level id/name/staple/meat/fruit/veg table. Fabricating
 * 271 rows would misrepresent the user's real spreadsheet data, so this list
 * currently holds a small representative sample (covering each portion group)
 * instead. Replace `SEED_ROWS` with the full exported table once it is
 * available; `seedFoodDictionary` and `seedRowToFoodItem` need no changes.
 */
export const SEED_ROWS: FoodSeedRow[] = [
  { id: 1, name: "飯/1碗", staple: 4, meat: 0, fruit: 0, veg: 0 },
  { id: 2, name: "熟肉(雞豬牛羊魚)/30g", staple: 0, meat: 1, fruit: 0, veg: 0 },
  { id: 3, name: "香蕉/1根", staple: 0, meat: 0, fruit: 2, veg: 0 },
  { id: 4, name: "蔬菜(煮熟)/1份", staple: 0, meat: 0, fruit: 0, veg: 1 },
];

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
    };
  });
  if (values.length === 0) return;
  await db.insert(foodItem).values(values);
}
