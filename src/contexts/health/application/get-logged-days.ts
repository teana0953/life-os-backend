import type { DietLogRepository } from "../domain/diet-log-repository";

/** Use case: the user's distinct logged days within `month` (YYYY-MM), ascending. */
export async function getLoggedDays(repository: DietLogRepository, userId: string, month: string): Promise<string[]> {
  return repository.listLoggedDays(userId, month);
}
