import type { CareItemRepository } from "../domain/care-item";
import type { CareLog, CareLogRepository } from "../domain/care-log";

export interface EditCareSlotInput {
  careScheduleId: string;
  localDate: string;
  timeOfDay: string;
  status: "done" | "skipped";
}

export interface EditCareSlotDeps {
  careItemRepo: CareItemRepository;
  careLogRepo: CareLogRepository;
}

/**
 * Use case: overwrite a slot's log status (`done` <-> `skipped`), for
 * editing a past (or present) day's record — unlike `answerCareSlot`
 * (`POST /api/care/log`), which is insert-if-absent and only ever the
 * FIRST write for a slot. Owner-scoped via the slot's schedule -> item; a
 * `null` return means no such schedule owned by `userId`.
 *
 * Stock delta (medication with tracked stock only): compares the log's
 * PREVIOUS status (`careLogRepo.upsert`'s `previousStatus`, `null` when no
 * log existed yet) against the new status, both collapsed to a
 * done/not-done boolean — `skipped` and "no log" are both "not done".
 * not-done -> done decrements the dose; done -> not-done increments it back;
 * any other transition (done -> done, not-done -> not-done) touches no
 * stock. Both directions clamp only on the decrement side (>= 0, same as
 * `answerCareSlot`) — an increment that undoes a clamped decrement can
 * restore more than was actually removed. That asymmetry is existing,
 * accepted semantics, not a bug to fix here.
 */
export async function editCareSlot(deps: EditCareSlotDeps, userId: string, input: EditCareSlotInput): Promise<CareLog | null> {
  const item = await deps.careItemRepo.getByScheduleId(input.careScheduleId);
  if (!item || item.userId !== userId) return null;
  const schedule = item.schedules.find((s) => s.id === input.careScheduleId);
  if (!schedule) return null;

  const { log, previousStatus } = await deps.careLogRepo.upsert({
    userId,
    careItemId: item.id,
    careScheduleId: input.careScheduleId,
    localDate: input.localDate,
    timeOfDay: input.timeOfDay,
    status: input.status,
    doneTime: input.status === "done" ? new Date() : null,
    doseQuantity: schedule.doseQuantity,
  });

  if (item.category === "medication" && item.stock !== null) {
    const wasDone = previousStatus === "done";
    const isDone = input.status === "done";
    if (isDone && !wasDone) {
      await deps.careItemRepo.decrementStock(item.id, schedule.doseQuantity);
    } else if (!isDone && wasDone) {
      await deps.careItemRepo.incrementStock(item.id, schedule.doseQuantity);
    }
  }

  return log;
}
