export interface CareOccurrence {
  id: string;
  userId: string;
  careItemId: string;
  careScheduleId: string;
  /** `YYYY-MM-DD`, local to the owning user (D5 in design.md). */
  localDate: string;
  /** Local `HH:mm`. */
  timeOfDay: string;
  lastNotifiedAt: Date | null;
}

export interface CreateCareOccurrenceInput {
  userId: string;
  careItemId: string;
  careScheduleId: string;
  localDate: string;
  timeOfDay: string;
}

export interface CareOccurrenceRepository {
  /** Insert-if-absent on the slot key `(careScheduleId, localDate, timeOfDay)`, returning the existing row on a conflict (D5 in design.md). */
  upsertBySlot(input: CreateCareOccurrenceInput): Promise<CareOccurrence>;
  getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareOccurrence | null>;
  touchNotified(id: string, at: Date): Promise<void>;
  /**
   * Occurrences of `careScheduleId` whose `localDate` is strictly before
   * `todayLocalDate` AND that have no `care_log` for their slot yet — for
   * markMissed (D7 in design.md). Once a slot is marked missed (or otherwise
   * answered), it has a log and drops out of this result on the next tick, so
   * per-tick work stays bounded to genuinely-unlogged past slots instead of
   * re-scanning all history forever.
   */
  listPastUnlogged(careScheduleId: string, todayLocalDate: string): Promise<CareOccurrence[]>;
}
