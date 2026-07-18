import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { FoodItem } from "../domain/food-item";

/** Use case: list a user's favorite dictionary items. */
export async function listFavoriteFoodItems(repository: FoodDictionaryRepository, userId: string): Promise<FoodItem[]> {
  return repository.listFavorites(userId);
}
