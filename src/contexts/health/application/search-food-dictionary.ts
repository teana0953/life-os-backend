import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { FoodItem } from "../domain/food-item";

/** Use case: search the dictionary (shared items ∪ the user's own custom items) by name substring. */
export async function searchFoodDictionary(
  repository: FoodDictionaryRepository,
  userId: string,
  query: string,
): Promise<FoodItem[]> {
  return repository.search(userId, query);
}
