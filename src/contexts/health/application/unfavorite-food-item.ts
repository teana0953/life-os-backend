import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";

export async function unfavoriteFoodItem(
  repository: FoodDictionaryRepository,
  userId: string,
  foodItemId: string,
): Promise<void> {
  await repository.unfavorite(userId, foodItemId);
}
