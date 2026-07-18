import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";

/** Use case: mark a dictionary item as a favorite for the given user. */
export async function favoriteFoodItem(
  repository: FoodDictionaryRepository,
  userId: string,
  foodItemId: string,
): Promise<void> {
  await repository.favorite(userId, foodItemId);
}
