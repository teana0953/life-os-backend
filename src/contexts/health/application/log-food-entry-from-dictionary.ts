import type { DietLogRepository } from "../domain/diet-log-repository";
import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { FoodEntry } from "../domain/food-entry";
import { gramsToQuantity, scaleByQuantity } from "../domain/quantity";

export interface LogFoodEntryFromDictionaryInput {
  userId: string;
  day: string;
  meal: string;
  foodItemId: string;
  /** Multiplier applied to the item's nutrients and portions (default 1); mutually exclusive with `grams`. */
  quantity?: number;
  /** Gram amount, converted to a quantity via the item's base_grams; mutually exclusive with `quantity`. */
  grams?: number;
  /** When the food was eaten; defaults to creation time (D3). */
  eatenAt?: Date;
}

/**
 * Use case: log a food entry by copying a dictionary item's nutrients and
 * portions scaled by `quantity` (default 1) or by `grams` converted to a
 * quantity via the item's base_grams (D1, D2 in design.md), with source "dict".
 */
export async function logFoodEntryFromDictionary(
  dietLogRepository: DietLogRepository,
  foodDictionaryRepository: FoodDictionaryRepository,
  input: LogFoodEntryFromDictionaryInput,
): Promise<FoodEntry> {
  const item = await foodDictionaryRepository.findById(input.userId, input.foodItemId);
  if (!item) throw new Error("food item not found");

  const quantity = input.grams !== undefined ? gramsToQuantity(input.grams, item.baseGrams) : input.quantity ?? 1;
  const scaled = scaleByQuantity(item, quantity);

  return dietLogRepository.create({
    userId: input.userId,
    day: input.day,
    meal: input.meal,
    name: item.name,
    photoRef: null,
    source: "dict",
    unclassified: false,
    eatenAt: input.eatenAt ?? new Date(),
    ...scaled,
  });
}
