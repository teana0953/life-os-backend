import type { ExerciseRepository } from "../domain/exercise-repository";

/** Use case: delete one of the user's own exercise entries. Returns the deleted
 * entry's `day` (so the caller can recompute it), or null if not owned/found. */
export async function deleteExerciseEntry(repository: ExerciseRepository, userId: string, entryId: string): Promise<string | null> {
  return repository.deleteEntry(userId, entryId);
}
