import type {
  ReminderSchedule,
  ReminderScheduleRepository,
  UpdateReminderSchedulePatch,
} from "../domain/reminder-schedule";

const CATEGORY = "medication";

/** Raised when a medication reminder's times/days_of_week/week_interval/anchor_date is invalid. */
export class InvalidReminderScheduleError extends Error {}

export interface CreateMedicationReminderInput {
  userId: string;
  label: string;
  times: string[];
  daysOfWeek: number[];
  weekInterval: number;
  anchorDate: string;
  enabled: boolean;
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateTimes(times: string[]): void {
  if (times.length === 0) throw new InvalidReminderScheduleError("times must contain at least one entry");
  for (const t of times) {
    if (!HH_MM.test(t)) throw new InvalidReminderScheduleError(`times entry must be HH:mm: ${t}`);
  }
}

function validateDaysOfWeek(daysOfWeek: number[]): void {
  if (daysOfWeek.length === 0) throw new InvalidReminderScheduleError("days_of_week must contain at least one entry");
  for (const d of daysOfWeek) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new InvalidReminderScheduleError(`days_of_week entry must be an integer 0-6: ${d}`);
    }
  }
}

function validateWeekInterval(weekInterval: number): void {
  if (!Number.isInteger(weekInterval) || weekInterval < 1) {
    throw new InvalidReminderScheduleError(`week_interval must be an integer >= 1: ${weekInterval}`);
  }
}

/**
 * `YYYY-MM-DD` and a real calendar date. Component comparison rather than
 * `Date.parse`, since V8 silently rolls over an invalid day (e.g.
 * `2026-02-30` -> Mar 2) instead of rejecting it.
 */
function validateAnchorDate(anchorDate: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorDate);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day) return;
  }
  throw new InvalidReminderScheduleError(`anchor_date must be a valid date (YYYY-MM-DD): ${anchorDate}`);
}

/** Use case: create a medication reminder schedule, validating its recurrence fields. */
export async function createMedicationReminder(
  repository: ReminderScheduleRepository,
  input: CreateMedicationReminderInput,
): Promise<ReminderSchedule> {
  validateTimes(input.times);
  validateDaysOfWeek(input.daysOfWeek);
  validateWeekInterval(input.weekInterval);
  validateAnchorDate(input.anchorDate);
  return repository.create({ ...input, category: CATEGORY });
}

/** Use case: list the caller's medication reminder schedules. */
export async function listMedicationReminders(
  repository: ReminderScheduleRepository,
  userId: string,
): Promise<ReminderSchedule[]> {
  const all = await repository.listByUser(userId);
  return all.filter((s) => s.category === CATEGORY);
}

/**
 * Use case: partially update a medication reminder (owner- and category-scoped
 * — a `null` return means no such schedule owned by `userId` with category
 * `medication`, e.g. a rehab-category row in the same table). Any provided
 * field is validated just as `create` does.
 */
export async function updateMedicationReminder(
  repository: ReminderScheduleRepository,
  id: string,
  userId: string,
  patch: UpdateReminderSchedulePatch,
): Promise<ReminderSchedule | null> {
  const existing = await repository.get(id);
  if (!existing || existing.userId !== userId || existing.category !== CATEGORY) return null;

  if (patch.times !== undefined) validateTimes(patch.times);
  if (patch.daysOfWeek !== undefined) validateDaysOfWeek(patch.daysOfWeek);
  if (patch.weekInterval !== undefined) validateWeekInterval(patch.weekInterval);
  if (patch.anchorDate !== undefined) validateAnchorDate(patch.anchorDate);
  return repository.update(id, userId, patch);
}

/**
 * Use case: delete a medication reminder (owner- and category-scoped;
 * returns whether a row was deleted — `false` for a non-medication row in
 * the same table, e.g. a rehab-category schedule).
 */
export async function deleteMedicationReminder(
  repository: ReminderScheduleRepository,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await repository.get(id);
  if (!existing || existing.userId !== userId || existing.category !== CATEGORY) return false;
  return repository.delete(id, userId);
}
