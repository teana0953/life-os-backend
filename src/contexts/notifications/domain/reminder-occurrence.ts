export type ReminderOccurrenceStatus = "pending" | "sent" | "skipped" | "failed";

export interface ReminderOccurrence {
  id: string;
  userId: string;
  /** e.g. "medication". */
  kind: string;
  dueAt: Date;
  title: string;
  body: string;
  status: ReminderOccurrenceStatus;
  /** `${scheduleId}|${localDate}|${hhmm}` — unique; guarantees exactly one row per schedule/day/time (D2 in design.md). */
  dedupeKey: string;
}

export interface CreateReminderOccurrenceInput {
  userId: string;
  kind: string;
  dueAt: Date;
  title: string;
  body: string;
  dedupeKey: string;
}

export interface ReminderOccurrenceRepository {
  /** Inserts only if `dedupeKey` is absent (unique constraint, insert-if-absent — D2 in design.md); returns the existing row on a conflict. */
  upsertByDedupeKey(input: CreateReminderOccurrenceInput): Promise<ReminderOccurrence>;
  /** `status = "pending"` and `dueAt <= now`. */
  listDuePending(now: Date): Promise<ReminderOccurrence[]>;
  markSent(id: string): Promise<void>;
  markSkipped(id: string): Promise<void>;
  markFailed(id: string): Promise<void>;
}
