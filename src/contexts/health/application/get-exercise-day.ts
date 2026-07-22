import type { ExerciseCategory } from "../domain/exercise-activity";
import { findActivity } from "../domain/exercise-activity";
import type { ExerciseRepository } from "../domain/exercise-repository";

export interface ExerciseDayEntry {
  id: string;
  activityId: string;
  /** Enriched from the static library on read; null when the id is not in the library. */
  activityName: string | null;
  category: ExerciseCategory | null;
  durationMinutes: number;
  note: string;
  createdAt: Date;
}

export interface ExerciseDay {
  day: string;
  entries: ExerciseDayEntry[];
  totalMinutes: number;
}

/**
 * Use case: a day's exercise entries enriched with activity name/category, plus
 * the summed total duration. A day with no entries reports an empty list and a
 * total of 0 (mirroring bowel/water's "no record → default").
 */
export async function getExerciseDay(repository: ExerciseRepository, userId: string, day: string): Promise<ExerciseDay> {
  const entries = await repository.listByDay(userId, day);

  let totalMinutes = 0;
  const dayEntries: ExerciseDayEntry[] = entries.map((entry) => {
    totalMinutes += entry.durationMinutes;
    const activity = findActivity(entry.activityId);
    return {
      id: entry.id,
      activityId: entry.activityId,
      activityName: activity ? activity.name : null,
      category: activity ? activity.category : null,
      durationMinutes: entry.durationMinutes,
      note: entry.note,
      createdAt: entry.createdAt,
    };
  });

  return { day, entries: dayEntries, totalMinutes };
}
