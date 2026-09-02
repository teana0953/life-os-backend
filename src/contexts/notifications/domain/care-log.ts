import type { CareCategory } from "./care-item";

export type CareLogStatus = "done" | "skipped" | "missed";

/**
 * Write-time snapshot of the item's naming attributes, so a log is readable
 * with no join to `care_item` (preserve-care-logs-on-item-delete D1). Never
 * re-synced when the item changes: a record reports what was taken at the
 * time.
 */
export interface CareLogItemSnapshot {
  itemTitle: string;
  itemCategory: CareCategory;
  itemDose: string | null;
}

export interface CareLog extends CareLogItemSnapshot {
  id: string;
  userId: string;
  /**
   * Each id is null exactly when ITS OWN parent row is gone — the two foreign
   * keys are separate `ON DELETE SET NULL`s (D2 in design.md), so they do not
   * move together.
   *
   * `null` = the item was deleted (which cascades its schedules, so
   * `careScheduleId` is null too).
   */
  careItemId: string | null;
  /**
   * `null` = the schedule behind this record is gone. That happens when the
   * item was deleted, but ALSO when the item is still live and only this
   * time-of-day's schedule was removed (an item edit dropping one time) — in
   * which case `careItemId` above is still set. A null here is therefore not
   * evidence that the item was deleted.
   */
  careScheduleId: string | null;
  /** `YYYY-MM-DD`, local to the owning user (D5 in design.md). */
  localDate: string;
  /** Local `HH:mm`. */
  timeOfDay: string;
  status: CareLogStatus;
  doneTime: Date | null;
  doseQuantity: number;
}

/**
 * The ids stay non-null here on purpose: every write path resolves a live
 * schedule first and bails when it is gone, so an orphaned row is only ever
 * made by a delete, never inserted as one (D2 in design.md).
 */
export interface CreateCareLogInput extends CareLogItemSnapshot {
  userId: string;
  careItemId: string;
  careScheduleId: string;
  localDate: string;
  timeOfDay: string;
  status: CareLogStatus;
  doneTime: Date | null;
  doseQuantity: number;
}

export interface CareLogRepository {
  /**
   * Insert-if-absent on the slot key `(careScheduleId, localDate, timeOfDay)`
   * — never clobbers an existing log (D6/D7 in design.md). `created` is
   * `false` when a log already existed, in which case `log` is that existing
   * row (unchanged) rather than `input`.
   */
  upsertIfAbsent(input: CreateCareLogInput): Promise<{ log: CareLog; created: boolean }>;
  getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareLog | null>;
  /** All of `userId`'s logs for `localDate` — one batch read for the care-today endpoint (D2 in design.md). */
  listByUserAndDate(userId: string, localDate: string): Promise<CareLog[]>;
  /** All of `userId`'s logs within `[from, to]` inclusive — one batch read for the care-range endpoint. */
  listByUserAndDateRange(userId: string, from: string, to: string): Promise<CareLog[]>;
  /**
   * Overwrites (not insert-if-absent) the log for the slot key
   * `(careScheduleId, localDate, timeOfDay)` — used to edit a past slot's
   * status. Returns the new log and the status that was in place before the
   * write, or `null` when no log existed for that slot yet.
   */
  upsert(input: CreateCareLogInput): Promise<{ log: CareLog; previousStatus: CareLogStatus | null }>;
}
