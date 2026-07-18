import type { CreateCustomFoodItemInput, FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { FoodItem } from "../domain/food-item";

/** Use case: create a food item owned by (and visible only to) the given user. */
export async function createCustomFoodItem(
  repository: FoodDictionaryRepository,
  input: CreateCustomFoodItemInput,
): Promise<FoodItem> {
  return repository.createCustom(input);
}
