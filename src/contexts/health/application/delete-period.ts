import type { MenstrualRepository } from "../domain/menstrual-repository";

/** Use case: delete one of the user's own periods. Returns false if not owned/found. */
export async function deletePeriod(repository: MenstrualRepository, userId: string, id: string): Promise<boolean> {
  return repository.delete(userId, id);
}
