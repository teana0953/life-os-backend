import type { MenstrualPeriod } from "./menstrual-period";

export interface AddPeriodInput {
  userId: string;
  startDate: string;
  endDate: string | null;
}

/**
 * Partial-update patch (three-state semantics): an ABSENT field (undefined)
 * means "keep the current value"; `endDate: null` clears the end date (reopens a
 * completed period); a string sets it. `update` applies ONLY the fields present
 * on the patch.
 */
export interface UpdatePeriodPatch {
  startDate?: string;
  endDate?: string | null;
}

export interface MenstrualRepository {
  /**
   * Inserts a period and returns it. Does NOT check that `endDate` is not
   * earlier than `startDate` — that invariant lives in the `addPeriod` use
   * case, which every writer is expected to go through.
   */
  add(input: AddPeriodInput): Promise<MenstrualPeriod>;
  /** The user's periods, ascending by startDate. */
  listByUser(userId: string): Promise<MenstrualPeriod[]>;
  /**
   * Updates the owned period, applying only the patch's present fields; returns
   * the updated period, or null when not owned/found.
   */
  update(userId: string, id: string, patch: UpdatePeriodPatch): Promise<MenstrualPeriod | null>;
  /** Deletes the period if owned by userId; returns whether one was deleted. */
  delete(userId: string, id: string): Promise<boolean>;
}
