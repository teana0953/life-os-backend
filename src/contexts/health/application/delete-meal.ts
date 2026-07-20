import type { MealRepository } from "../domain/meal-repository";

/** Use case: delete one of the user's own meals; cascades its items. Returns false if not owned/found. */
export async function deleteMeal(repository: MealRepository, userId: string, mealId: string): Promise<boolean> {
  return repository.deleteMeal(userId, mealId);
}
