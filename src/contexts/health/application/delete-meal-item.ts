import type { MealRepository } from "../domain/meal-repository";

/** Use case: delete one of the user's own meal items. Returns false if not owned/found. */
export async function deleteMealItem(repository: MealRepository, userId: string, itemId: string): Promise<boolean> {
  return repository.deleteItem(userId, itemId);
}
