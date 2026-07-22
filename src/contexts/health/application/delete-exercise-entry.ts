import type { ExerciseRepository } from "../domain/exercise-repository";

/** Use case: delete one of the user's own exercise entries. Returns false if not owned/found. */
export async function deleteExerciseEntry(repository: ExerciseRepository, userId: string, entryId: string): Promise<boolean> {
  return repository.deleteEntry(userId, entryId);
}
