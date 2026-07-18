import type { FoodDictionaryRepository } from "../domain/food-dictionary-repository";

/**
 * Use case: mark a dictionary item as a favorite for the given user. Only items
 * visible to the user (shared, or their own custom) can be favorited — another
 * user's private custom item is treated as not found.
 */
export async function favoriteFoodItem(
  repository: FoodDictionaryRepository,
  userId: string,
  foodItemId: string,
): Promise<void> {
  const item = await repository.findById(userId, foodItemId);
  if (!item) throw new Error("food item not found");
  await repository.favorite(userId, foodItemId);
}
