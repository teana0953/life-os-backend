import { localMinute, localParts } from "../domain/reminder-clock";
import type { CareCategory, CareItemRepository } from "../domain/care-item";
import type { CareLogRepository, CareLogStatus } from "../domain/care-log";
import type { UserRepository } from "../../user/domain/user-repository";

export interface GetCareTodayDeps {
  userRepo: UserRepository;
  careItemRepo: CareItemRepository;
  careLogRepo: CareLogRepository;
}

export interface CareTodaySlot {
  careItemId: string;
  careScheduleId: string;
  category: CareCategory;
  title: string;
  note: string | null;
  /** Medication only; `null` for other categories. */
  dose: string | null;
  timeOfDay: string;
  localDate: string;
  status: CareLogStatus | "pending" | "overdue";
  doneTime: Date | null;
  doseQuantity: number;
}

export interface CareTodayResult {
  date: string;
  items: CareTodaySlot[];
}

/**
 * Use case: today's active care slots, in the owner's local time, each
 * tagged with a status derived at read time (never written) — D1 in
 * add-care-today-endpoint/design.md. A `care_log` for the slot wins (its
 * status + done_time, including a `missed` log — defensive pass-through
 * only; a today-scoped slot is never actually surfaced as `missed` since the
 * Cron's markMissed only marks strictly-past local days). Otherwise:
 * `overdue` when the slot's local time is at/before now, else `pending`.
 * Read-only, no writes. `now` is injected so callers can pin time in tests.
 */
export async function getCareToday(deps: GetCareTodayDeps, userId: string, now: Date): Promise<CareTodayResult> {
  const user = await deps.userRepo.getById(userId);
  if (!user) throw new Error(`user not found: ${userId}`);

  const nowLocal = localParts(now, user.timezone);
  const nowMinute = localMinute(nowLocal.date, nowLocal.hhmm);

  const schedules = await deps.careItemRepo.listActiveSchedulesForUserOn(userId, nowLocal.date);
  const logs = await deps.careLogRepo.listByUserAndDate(userId, nowLocal.date);
  const logsBySlot = new Map(logs.map((log) => [`${log.careScheduleId}|${log.timeOfDay}`, log]));

  const items: CareTodaySlot[] = schedules.map(({ item, schedule }) => {
    const log = logsBySlot.get(`${schedule.id}|${schedule.timeOfDay}`);
    const slotMinute = localMinute(nowLocal.date, schedule.timeOfDay);
    const status: CareTodaySlot["status"] = log ? log.status : slotMinute <= nowMinute ? "overdue" : "pending";

    return {
      careItemId: item.id,
      careScheduleId: schedule.id,
      category: item.category,
      title: item.title,
      note: item.note,
      dose: item.dose,
      timeOfDay: schedule.timeOfDay,
      localDate: nowLocal.date,
      status,
      doneTime: log ? log.doneTime : null,
      doseQuantity: schedule.doseQuantity,
    };
  });

  return { date: nowLocal.date, items };
}
