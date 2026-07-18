import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";

/** Use case: unmark a dictionary item as a favorite for the given user. */
export async function unfavoriteFoodItem(
  repository: FoodDictionaryRepository,
  userId: string,
  foodItemId: string,
): Promise<void> {
  await repository.unfavorite(userId, foodItemId);
}
