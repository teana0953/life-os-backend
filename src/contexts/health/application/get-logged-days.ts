import type { MealRepository } from "../domain/meal-repository";

/** Use case: the user's distinct logged days within `month` (YYYY-MM), ascending. */
export async function getLoggedDays(repository: MealRepository, userId: string, month: string): Promise<string[]> {
  return repository.listLoggedDays(userId, month);
}
