import { EXERCISE_ACTIVITIES, type ExerciseActivity } from "../domain/exercise-activity";

/** Use case: the static, read-only activity library (keeps HTTP off the domain constant directly). */
export function listExerciseActivities(): readonly ExerciseActivity[] {
  return EXERCISE_ACTIVITIES;
}
