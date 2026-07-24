import { weekdayOf, weeksSince } from "./reminder-clock";
import type { CareSchedule } from "./care-item";

/**
 * Whether `schedule` is active on `localDate`: weekday selected (or
 * `repeatDays` empty = every day, D3 in add-medication-reminders/design.md),
 * within `[startDate, endDate]`, and the every-N-weeks interval (anchored to
 * `startDate`) is on. Shared by `run-care-tick` and `getCareToday` (D4 in
 * add-care-today-endpoint/design.md) so they can never drift.
 */
export function isActiveOn(schedule: CareSchedule, localDate: string): boolean {
  if (schedule.repeatDays.length > 0 && !schedule.repeatDays.includes(weekdayOf(localDate))) return false;
  if (localDate < schedule.startDate) return false;
  if (schedule.endDate !== null && localDate > schedule.endDate) return false;
  const weeks = weeksSince(schedule.startDate, localDate);
  return weeks >= 0 && weeks % schedule.weekInterval === 0;
}
