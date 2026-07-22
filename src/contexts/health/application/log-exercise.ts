import { findActivity } from "../domain/exercise-activity";
import type { ExerciseEntry } from "../domain/exercise-entry";
import type { AddExerciseEntryInput, ExerciseRepository } from "../domain/exercise-repository";

/** Raised when an exercise log is invalid (unknown activity or non-positive duration). */
export class InvalidExerciseError extends Error {}

/**
 * Use case: append an exercise entry. Rejects an `activityId` not in the static
 * library and a non-positive `durationMinutes` before persisting.
 */
export async function logExercise(repository: ExerciseRepository, input: AddExerciseEntryInput): Promise<ExerciseEntry> {
  if (!findActivity(input.activityId)) {
    throw new InvalidExerciseError(`unknown activity: ${input.activityId}`);
  }
  if (!(input.durationMinutes > 0)) {
    throw new InvalidExerciseError("duration_minutes must be greater than 0");
  }
  return repository.addEntry(input);
}
