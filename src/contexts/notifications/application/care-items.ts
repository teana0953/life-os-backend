import type { UserRepository } from "../../user/domain/user-repository";
import type {
  CareCategory,
  CareItemRepository,
  CareItemWithSchedules,
  CareScheduleInput,
  CreateCareItemInput,
  UpdateCareItemPatch,
} from "../domain/care-item";
import type { CareDayInstanceManager } from "../domain/care-day-instance";
import { restartCareDayBestEffort } from "./restart-care-day";

/**
 * Optional immediate-effect hook (key_decisions "即時生效機制" in
 * replace-cron-with-workflows/design.md): when provided, a successful
 * create/update/delete best-effort restarts the caller's today instance so
 * the change is live within seconds. Optional so every existing caller
 * (including every test in this file) keeps working unchanged.
 */
export interface CareItemNotifyDeps {
  instanceManager: CareDayInstanceManager;
  userRepository: Pick<UserRepository, "getById">;
}

/** Raised when a care item's category or a schedule's fields are invalid. */
export class InvalidCareItemError extends Error {}

const CATEGORIES: CareCategory[] = ["medication", "rehab", "radiotherapy_care", "custom"];
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateCategory(category: string): void {
  if (!CATEGORIES.includes(category as CareCategory)) {
    throw new InvalidCareItemError(`category must be one of ${CATEGORIES.join(", ")}: ${category}`);
  }
}

/**
 * `YYYY-MM-DD` and a real calendar date. Component comparison rather than
 * `Date.parse`, since V8 silently rolls over an invalid day (e.g.
 * `2026-02-30` -> Mar 2) instead of rejecting it.
 */
function validateDate(value: string, field: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day) return;
  }
  throw new InvalidCareItemError(`${field} must be a valid date (YYYY-MM-DD): ${value}`);
}

function validateSchedule(schedule: CareScheduleInput): void {
  if (!HH_MM.test(schedule.timeOfDay)) {
    throw new InvalidCareItemError(`time_of_day must be HH:mm: ${schedule.timeOfDay}`);
  }
  for (const d of schedule.repeatDays) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new InvalidCareItemError(`repeat_days entry must be an integer 0-6: ${d}`);
    }
  }
  if (!Number.isInteger(schedule.weekInterval) || schedule.weekInterval < 1) {
    throw new InvalidCareItemError(`week_interval must be an integer >= 1: ${schedule.weekInterval}`);
  }
  validateDate(schedule.startDate, "start_date");
  if (schedule.endDate) {
    validateDate(schedule.endDate, "end_date");
    if (schedule.endDate < schedule.startDate) {
      throw new InvalidCareItemError("end_date must not be before start_date");
    }
  }
  if (!Number.isInteger(schedule.nagIntervalMinutes) || schedule.nagIntervalMinutes < 0) {
    throw new InvalidCareItemError(`nag_interval_minutes must be an integer >= 0: ${schedule.nagIntervalMinutes}`);
  }
  if (!Number.isInteger(schedule.doseQuantity) || schedule.doseQuantity < 1) {
    throw new InvalidCareItemError(`dose_quantity must be an integer >= 1: ${schedule.doseQuantity}`);
  }
}

function validateNonNegativeInteger(value: number | null | undefined, field: string): void {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidCareItemError(`${field} must be an integer >= 0: ${value}`);
  }
}

/** Use case: create a care item and its schedules, validating category + each schedule's fields. */
export async function createCareItem(
  repository: CareItemRepository,
  input: CreateCareItemInput,
  notify?: CareItemNotifyDeps,
): Promise<CareItemWithSchedules> {
  validateCategory(input.category);
  validateNonNegativeInteger(input.stock, "stock");
  validateNonNegativeInteger(input.stockAlert, "stock_alert");
  for (const schedule of input.schedules) validateSchedule(schedule);
  const created = await repository.create(input);
  if (notify) await restartCareDayBestEffort(input.userId, notify.instanceManager, notify.userRepository, repository);
  return created;
}

/** Use case: list the caller's care items, optionally filtered by category. */
export async function listCareItems(
  repository: CareItemRepository,
  userId: string,
  category?: CareCategory,
): Promise<CareItemWithSchedules[]> {
  return repository.listByUser(userId, category);
}

/**
 * Use case: partially update a care item and (if provided) upsert its
 * schedules by id (owner-scoped; a `null` return means no such item owned by
 * `userId`). Any provided field is validated just as `create` does.
 */
export async function updateCareItem(
  repository: CareItemRepository,
  id: string,
  userId: string,
  patch: UpdateCareItemPatch,
  notify?: CareItemNotifyDeps,
): Promise<CareItemWithSchedules | null> {
  const existing = await repository.get(id);
  if (!existing || existing.userId !== userId) return null;

  if (patch.category !== undefined) validateCategory(patch.category);
  if (patch.stock !== undefined) validateNonNegativeInteger(patch.stock, "stock");
  if (patch.stockAlert !== undefined) validateNonNegativeInteger(patch.stockAlert, "stock_alert");
  if (patch.schedules !== undefined) {
    for (const schedule of patch.schedules) validateSchedule(schedule);
  }
  const updated = await repository.update(id, userId, patch);
  if (updated && notify) await restartCareDayBestEffort(userId, notify.instanceManager, notify.userRepository, repository);
  return updated;
}

/** Use case: delete a care item (owner-scoped; returns whether a row was deleted). */
export async function deleteCareItem(
  repository: CareItemRepository,
  id: string,
  userId: string,
  notify?: CareItemNotifyDeps,
): Promise<boolean> {
  const existing = await repository.get(id);
  if (!existing || existing.userId !== userId) return false;
  const deleted = await repository.delete(id, userId);
  if (deleted && notify) await restartCareDayBestEffort(userId, notify.instanceManager, notify.userRepository, repository);
  return deleted;
}
