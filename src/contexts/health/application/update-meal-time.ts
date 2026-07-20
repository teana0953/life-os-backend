import type { MealSummary } from "../domain/meal-entry";
import type { MealRepository } from "../domain/meal-repository";

/** Use case: update one of the user's own meal's time; does not move its day (D2). Returns null if not owned/found. */
export async function updateMealTime(
  repository: MealRepository,
  userId: string,
  mealId: string,
  time: Date,
): Promise<MealSummary | null> {
  return repository.updateMealTime(userId, mealId, time);
}
