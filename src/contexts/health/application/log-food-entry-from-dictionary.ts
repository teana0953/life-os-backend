import type { DietLogRepository } from "../domain/diet-log-repository";
import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { FoodEntry } from "../domain/food-entry";

export interface LogFoodEntryFromDictionaryInput {
  userId: string;
  day: string;
  meal: string;
  foodItemId: string;
}

/** Use case: log a food entry by copying a dictionary item's nutrients and portions, with source "dict". */
export async function logFoodEntryFromDictionary(
  dietLogRepository: DietLogRepository,
  foodDictionaryRepository: FoodDictionaryRepository,
  input: LogFoodEntryFromDictionaryInput,
): Promise<FoodEntry> {
  const item = await foodDictionaryRepository.findById(input.foodItemId);
  if (!item) throw new Error("food item not found");

  return dietLogRepository.create({
    userId: input.userId,
    day: input.day,
    meal: input.meal,
    name: item.name,
    photoRef: null,
    source: "dict",
    unclassified: false,
    carbG: item.carbG,
    proteinG: item.proteinG,
    fatG: item.fatG,
    sugarG: item.sugarG,
    fiberG: item.fiberG,
    kcal: item.kcal,
    staple: item.staple,
    meat: item.meat,
    fruit: item.fruit,
    veg: item.veg,
  });
}
