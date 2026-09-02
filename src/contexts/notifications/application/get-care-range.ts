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
 *
 * A day's slots are the UNION of that expansion and every log on that date
 * (preserve-care-logs-on-item-delete D3): a log whose slot the expansion never
 * produced — its item was deleted, its schedule was removed or disabled, or the
 * schedule is inactive on the date it was recorded — is emitted on its own
 * `localDate` from its own stored fields, with no extra repository read.
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

  const itemById = new Map(items.map((item) => [item.id, item]));
  // Log ids, not slot keys: an orphaned log has a null schedule id, so a slot
  // key cannot identify it (D2 — Postgres treats those NULLs as distinct).
  const consumedLogIds = new Set<string>();

  const slotsByDate = new Map<string, CareTodaySlot[]>();
  const days: CareRangeDay[] = [];
  for (let date = from; date <= to; date = nextLocalDate(date)) {
    const daySlots: CareTodaySlot[] = [];
    slotsByDate.set(date, daySlots);

    for (const item of items) {
      for (const schedule of item.schedules) {
        if (!schedule.enabled || !isActiveOn(schedule, date)) continue;

        const log = logsBySlot.get(`${schedule.id}|${schedule.timeOfDay}|${date}`);
        if (log) consumedLogIds.add(log.id);
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
          itemDeleted: false,
        });
      }
    }

    days.push({ date, items: daySlots });
  }

  for (const log of logs) {
    if (consumedLogIds.has(log.id)) continue;
    const daySlots = slotsByDate.get(log.localDate);
    if (!daySlots) continue;

    // D4: the live item wins where there still is one, so a rename shows on a
    // record whose schedule merely lapsed; the snapshot answers only when there
    // is nothing better. A non-null `careItemId` that resolves to nothing is
    // unreachable while the foreign key stands, but the fallback is total.
    const item = log.careItemId === null ? undefined : itemById.get(log.careItemId);

    daySlots.push({
      careItemId: log.careItemId,
      careScheduleId: log.careScheduleId,
      category: item ? item.category : log.itemCategory,
      title: item ? item.title : log.itemTitle,
      note: item ? item.note : null,
      dose: item ? item.dose : log.itemDose,
      timeOfDay: log.timeOfDay,
      localDate: log.localDate,
      // Verbatim: with no schedule behind it there is no pending/overdue/missed
      // to derive, only what was recorded.
      status: log.status,
      doneTime: log.doneTime,
      doseQuantity: log.doseQuantity,
      itemDeleted: item === undefined,
    });
  }

  // After the union, so records with no live slot interleave by time rather
  // than trailing the day in a second block.
  for (const day of days) {
    day.items.sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay) || a.title.localeCompare(b.title));
  }

  return { from, to, days };
}
