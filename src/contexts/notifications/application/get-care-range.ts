import { isActiveOn } from "../domain/care-schedule";
import { localMinute, localParts, nextLocalDate } from "../../../shared-kernel/reminder-clock";
import type { CareItemRepository } from "../domain/care-item";
import type { CareLogRepository } from "../domain/care-log";
import type { UserRepository } from "../../user/domain/user-repository";
import type { CareTodaySlot } from "./get-care-today";

export interface GetCareRangeDeps {
  userRepo: UserRepository;
  careItemRepo: CareItemRepository;
  careLogRepo: CareLogRepository;
}

export interface CareRangeDay {
  date: string;
  items: CareTodaySlot[];
}

export interface CareRangeResult {
  from: string;
  to: string;
  days: CareRangeDay[];
}

/**
 * Use case: `getCareToday` generalized to a `[from, to]` local-date range —
 * per-slot care records for a history view (D in
 * 2026-07-25-care-history-range-design.md). Fetches ALL of the owner's
 * schedules once (`listByUser`, unfiltered by enabled/active — unlike
 * `getCareToday`'s SQL-prefiltered `listActiveSchedulesForUserOn`) and their
 * logs for the whole range once (`listByUserAndDateRange`), then expands
 * in-memory per day: a schedule produces a slot on a given day only when
 * BOTH `schedule.enabled` AND `isActiveOn(schedule, date)` (the shared
 * `isActiveOn` does not itself check `enabled`). Status: a log for the slot
 * wins; otherwise `missed` for a strictly-past day, `overdue`/`pending` for
 * today (by the slot's local time vs. now), `pending` for a future day.
 * today/now are computed in the owner's timezone. Read-only, no writes.
 */
export async function getCareRange(deps: GetCareRangeDeps, userId: string, from: string, to: string, now: Date): Promise<CareRangeResult> {
  const user = await deps.userRepo.getById(userId);
  if (!user) throw new Error(`user not found: ${userId}`);

  const nowLocal = localParts(now, user.timezone);
  const today = nowLocal.date;
  const nowMinute = localMinute(nowLocal.date, nowLocal.hhmm);

  const items = await deps.careItemRepo.listByUser(userId);
  const logs = await deps.careLogRepo.listByUserAndDateRange(userId, from, to);
  const logsBySlot = new Map(logs.map((log) => [`${log.careScheduleId}|${log.timeOfDay}|${log.localDate}`, log]));

  const days: CareRangeDay[] = [];
  for (let date = from; date <= to; date = nextLocalDate(date)) {
    const daySlots: CareTodaySlot[] = [];

    for (const item of items) {
      for (const schedule of item.schedules) {
        if (!schedule.enabled || !isActiveOn(schedule, date)) continue;

        const log = logsBySlot.get(`${schedule.id}|${schedule.timeOfDay}|${date}`);
        const slotMinute = localMinute(date, schedule.timeOfDay);
        const status: CareTodaySlot["status"] = log
          ? log.status
          : date < today
            ? "missed"
            : date === today
              ? slotMinute <= nowMinute
                ? "overdue"
                : "pending"
              : "pending";

        daySlots.push({
          careItemId: item.id,
          careScheduleId: schedule.id,
          category: item.category,
          title: item.title,
          note: item.note,
          dose: item.dose,
          timeOfDay: schedule.timeOfDay,
          localDate: date,
          status,
          doneTime: log ? log.doneTime : null,
          doseQuantity: schedule.doseQuantity,
        });
      }
    }

    daySlots.sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay) || a.title.localeCompare(b.title));
    days.push({ date, items: daySlots });
  }

  return { from, to, days };
}
