import type { DietLogRepository } from "../domain/diet-log-repository";

/** Use case: delete one of the user's own food entries. Returns false if no matching entry was owned by the user. */
export async function deleteFoodEntry(repository: DietLogRepository, userId: string, entryId: string): Promise<boolean> {
  return repository.delete(userId, entryId);
}
