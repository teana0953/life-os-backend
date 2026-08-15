import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { FoodItem } from "../domain/food-item";

export async function listFavoriteFoodItems(repository: FoodDictionaryRepository, userId: string): Promise<FoodItem[]> {
  return repository.listFavorites(userId);
}
