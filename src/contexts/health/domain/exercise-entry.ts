export interface ExerciseEntry {
  id: string;
  userId: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  day: string;
  /** References an activity in the static library. */
  activityId: string;
  /** Duration in minutes (positive integer). */
  durationMinutes: number;
  /** Free-text note (empty string when none). */
  note: string;
  createdAt: Date;
}
