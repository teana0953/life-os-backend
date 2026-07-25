export type CareCategory = "medication" | "rehab" | "radiotherapy_care" | "custom";

export interface CareSchedule {
  id: string;
  careItemId: string;
  /** Local `HH:mm`. */
  timeOfDay: string;
  /** 0 (Sunday) .. 6 (Saturday); empty = every day (D3 in design.md). */
  repeatDays: number[];
  weekInterval: number;
  /** `YYYY-MM-DD`, the every-N-weeks recurrence anchor and the earliest active date. */
  startDate: string;
  /** `YYYY-MM-DD`, inclusive; `null` = no end. */
  endDate: string | null;
  doseQuantity: number;
  /** 0 = fire once, never re-nag (D4 in design.md). */
  nagIntervalMinutes: number;
  enabled: boolean;
}

export interface CareItem {
  id: string;
  userId: string;
  category: CareCategory;
  title: string;
  note: string | null;
  /** Medication only (D1 in design.md); ignored for other categories. */
  dose: string | null;
  stock: number | null;
  stockAlert: number | null;
}

export interface CareItemWithSchedules extends CareItem {
  schedules: CareSchedule[];
}

/**
 * A schedule in a create/update request. `id` present (update only) selects an
 * existing row to update in place; absent inserts a new one — D2 in design.md.
 */
export interface CareScheduleInput {
  id?: string;
  timeOfDay: string;
  repeatDays: number[];
  weekInterval: number;
  startDate: string;
  endDate?: string | null;
  doseQuantity: number;
  nagIntervalMinutes: number;
  enabled: boolean;
}

export interface CreateCareItemInput {
  userId: string;
  category: CareCategory;
  title: string;
  note?: string | null;
  dose?: string | null;
  stock?: number | null;
  stockAlert?: number | null;
  schedules: CareScheduleInput[];
}

export interface UpdateCareItemPatch {
  category?: CareCategory;
  title?: string;
  note?: string | null;
  dose?: string | null;
  stock?: number | null;
  stockAlert?: number | null;
  /** Present: upsert-by-id (update existing rows in place, insert new, delete only omitted — D2). Absent: schedules unchanged. */
  schedules?: CareScheduleInput[];
}

/** An enabled schedule joined with its item and owner's timezone, for the cron tick. */
export interface ActiveCareSchedule {
  item: CareItem;
  schedule: CareSchedule;
  timezone: string;
}

/** An enabled schedule joined with its item, scoped to one user (for the care-today endpoint). */
export interface ActiveScheduleForUser {
  item: CareItem;
  schedule: CareSchedule;
}

export interface CareItemRepository {
  create(input: CreateCareItemInput): Promise<CareItemWithSchedules>;
  listByUser(userId: string, category?: CareCategory): Promise<CareItemWithSchedules[]>;
  get(id: string): Promise<CareItemWithSchedules | null>;
  /** The item (with schedules) owning `scheduleId`, or `null` — resolves ownership/category/stock for answer-care-slot without a separate schedule repo. */
  getByScheduleId(scheduleId: string): Promise<CareItemWithSchedules | null>;
  /** Scoped to `userId`; schedules (if provided) are upserted by id (D2). A `null` return means no such item owned by `userId`. */
  update(id: string, userId: string, patch: UpdateCareItemPatch): Promise<CareItemWithSchedules | null>;
  /** Scoped to `userId`; returns whether a row was deleted. */
  delete(id: string, userId: string): Promise<boolean>;
  /** Every enabled schedule, joined with its item and owner's timezone — no per-schedule lookup needed by the cron tick. */
  listActiveSchedules(): Promise<ActiveCareSchedule[]>;
  /**
   * `userId`'s enabled schedules that are active on `localDate` (per the
   * shared `isActiveOn`), joined with their item — for the care-today
   * endpoint. Ordered by `timeOfDay`, then `title`.
   */
  listActiveSchedulesForUserOn(userId: string, localDate: string): Promise<ActiveScheduleForUser[]>;
  /** Reduces `stock` by `amount`, clamped >= 0; a no-op when the item's `stock` is `null` (D6 in design.md). */
  decrementStock(itemId: string, amount: number): Promise<void>;
  /** Increases `stock` by `amount`; a no-op when the item's `stock` is `null`. */
  incrementStock(itemId: string, amount: number): Promise<void>;
}
