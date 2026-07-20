import { portionsToNutrients, resolveKcal, type Portions } from "../domain/conversion";
import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { MealEntry } from "../domain/meal-entry";
import type { CreateMealItemInput, MealRepository } from "../domain/meal-repository";
import { measureToQuantity } from "../domain/quantity";

interface ManualNutrientsInput {
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal?: number;
}

interface ManualItemFields {
  name?: string | null;
  photoRef?: string | null;
}

/** One item to add to the meal: a dictionary item, or a manual item from portions or nutrients. */
export type CreateMealItem =
  | { foodItemId: string; quantity?: number; measure?: number }
  | (ManualItemFields & { portions: Portions; nutrients?: undefined })
  | (ManualItemFields & { nutrients: ManualNutrientsInput; portions?: undefined });

export interface CreateMealInput {
  userId: string;
  day: string;
  meal: string;
  /** Used only when creating a new meal for this (user, day, meal); defaults to creation time (D2). */
  time?: Date;
  items: CreateMealItem[];
}

function isDictItem(item: CreateMealItem): item is { foodItemId: string; quantity?: number; measure?: number } {
  return "foodItemId" in item;
}

/**
 * Use case: create-or-append a meal for (user, day, meal) with one or more
 * items in one call (D4). Each item stores per-unit values + `quantity`,
 * never pre-multiplied (D3): a dictionary item copies the dict item's
 * per-unit portions/nutrients and sets `quantity` from an explicit quantity
 * or `measure ÷ base_amount` (measure interpreted in the item's own
 * `measureUnit`, G3); a manual item stores the supplied per-unit portions
 * (deriving per-unit nutrients, classified) or nutrients (stored as given,
 * unclassified), `quantity` 1.
 */
export async function createMeal(
  mealRepository: MealRepository,
  foodDictionaryRepository: FoodDictionaryRepository,
  input: CreateMealInput,
): Promise<MealEntry> {
  const items: CreateMealItemInput[] = [];

  for (const item of input.items) {
    if (isDictItem(item)) {
      const dictItem = await foodDictionaryRepository.findById(input.userId, item.foodItemId);
      if (!dictItem) throw new Error("food item not found");

      const quantity =
        item.measure !== undefined ? measureToQuantity(item.measure, dictItem.baseAmount) : (item.quantity ?? 1);
      items.push({
        foodItemId: dictItem.id,
        name: dictItem.name,
        photoRef: null,
        source: "dict",
        unclassified: false,
        carbG: dictItem.carbG,
        proteinG: dictItem.proteinG,
        fatG: dictItem.fatG,
        sugarG: dictItem.sugarG,
        fiberG: dictItem.fiberG,
        kcal: dictItem.kcal,
        staple: dictItem.staple,
        meat: dictItem.meat,
        fruit: dictItem.fruit,
        veg: dictItem.veg,
        quantity,
        baseAmount: dictItem.baseAmount,
        measureUnit: dictItem.measureUnit,
      });
    } else if (item.portions) {
      const nutrients = portionsToNutrients(item.portions);
      items.push({
        foodItemId: null,
        name: item.name ?? null,
        photoRef: item.photoRef ?? null,
        source: "manual",
        unclassified: false,
        ...nutrients,
        ...item.portions,
        quantity: 1,
        baseAmount: null,
        measureUnit: null,
      });
    } else {
      const { carbG, proteinG, fatG, sugarG, fiberG, kcal } = item.nutrients;
      items.push({
        foodItemId: null,
        name: item.name ?? null,
        photoRef: item.photoRef ?? null,
        source: "manual",
        unclassified: true,
        carbG,
        proteinG,
        fatG,
        sugarG,
        fiberG,
        kcal: resolveKcal({ carbG, proteinG, fatG }, kcal),
        staple: 0,
        meat: 0,
        fruit: 0,
        veg: 0,
        quantity: 1,
        baseAmount: null,
        measureUnit: null,
      });
    }
  }

  return mealRepository.upsertMealWithItems({
    userId: input.userId,
    day: input.day,
    meal: input.meal,
    time: input.time,
    items,
  });
}
