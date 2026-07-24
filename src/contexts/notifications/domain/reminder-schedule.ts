export interface ReminderSchedule {
  id: string;
  userId: string;
  /** e.g. "medication"; rehab (a later slice) reuses this table with a different category. */
  category: string;
  label: string;
  /** Each entry is a local "HH:mm". */
  times: string[];
  /** 0 (Sunday) .. 6 (Saturday). */
  daysOfWeek: number[];
  /** Every-N-weeks recurrence, anchor-relative to `anchorDate` (D4 in design.md). */
  weekInterval: number;
  /** `YYYY-MM-DD`, the recurrence anchor. */
  anchorDate: string;
  enabled: boolean;
}

export interface CreateReminderScheduleInput {
  userId: string;
  category: string;
  label: string;
  times: string[];
  daysOfWeek: number[];
  weekInterval: number;
  anchorDate: string;
  enabled: boolean;
}

/** Any provided field replaces the stored value; omitted fields are left unchanged. */
export interface UpdateReminderSchedulePatch {
  label?: string;
  times?: string[];
  daysOfWeek?: number[];
  weekInterval?: number;
  anchorDate?: string;
  enabled?: boolean;
}

/** An active schedule joined with its owner's timezone, for the cron tick (D6b in design.md). */
export interface ActiveReminderSchedule {
  schedule: ReminderSchedule;
  timezone: string;
}

export interface ReminderScheduleRepository {
  create(input: CreateReminderScheduleInput): Promise<ReminderSchedule>;
  listByUser(userId: string): Promise<ReminderSchedule[]>;
  get(id: string): Promise<ReminderSchedule | null>;
  /** Scoped to `userId`: a `null` return means no such schedule owned by that user. */
  update(id: string, userId: string, patch: UpdateReminderSchedulePatch): Promise<ReminderSchedule | null>;
  /** Scoped to `userId`; returns whether a row was deleted. */
  delete(id: string, userId: string): Promise<boolean>;
  /** Every enabled schedule, joined with its owner's timezone — no per-schedule user lookup needed by the cron tick. */
  listActiveAll(): Promise<ActiveReminderSchedule[]>;
}
