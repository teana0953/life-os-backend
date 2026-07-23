import type { ExerciseEntry } from "./exercise-entry";

export interface AddExerciseEntryInput {
  userId: string;
  day: string;
  activityId: string;
  durationMinutes: number;
  note: string;
}

export interface ExerciseRepository {
  /** Appends an entry and returns it. */
  addEntry(input: AddExerciseEntryInput): Promise<ExerciseEntry>;
  /** The user's entries on `day`, ascending by createdAt. */
  listByDay(userId: string, day: string): Promise<ExerciseEntry[]>;
  /** Deletes the entry if owned by userId; returns its `day` (so the caller can
   * recompute that day), or null when nothing was deleted. */
  deleteEntry(userId: string, entryId: string): Promise<string | null>;
}
