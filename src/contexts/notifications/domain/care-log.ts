export type CareLogStatus = "done" | "skipped" | "missed";

export interface CareLog {
  id: string;
  userId: string;
  careItemId: string;
  careScheduleId: string;
  /** `YYYY-MM-DD`, local to the owning user (D5 in design.md). */
  localDate: string;
  /** Local `HH:mm`. */
  timeOfDay: string;
  status: CareLogStatus;
  doneTime: Date | null;
  doseQuantity: number;
}

export interface CreateCareLogInput {
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
  /** All of `userId`'s logs with `localDate` in `[from, to]` (inclusive) — one batch read for the care-adherence range endpoint. */
  listByUserAndDateRange(userId: string, from: string, to: string): Promise<CareLog[]>;
}
