import type { CareItemRepository } from "../domain/care-item";
import type { CareLog, CareLogRepository } from "../domain/care-log";

export interface EditCareSlotInput {
  careScheduleId: string;
  localDate: string;
  timeOfDay: string;
  status: "done" | "skipped";
  /**
   * The completion time to record when `status` is `"done"`. Semantics are
   * "unspecified = don't touch this field", NOT "reset to now": when omitted
   * and the slot is already `done`, its existing `doneTime` is preserved
   * (see `editCareSlot`'s doc comment). Ignored when `status` is `"skipped"`.
   */
  doneTime?: Date;
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
 * `doneTime` resolution (see `EditCareSlotInput.doneTime` and proposal.md's
 * table): `status: "skipped"` always writes `null` regardless of
 * `input.doneTime` (a skip never completed). `status: "done"` with
 * `input.doneTime` supplied writes that value. `status: "done"` without
 * `input.doneTime` writes `new Date()` UNLESS the slot's existing log is
 * already `done`, in which case its existing `doneTime` is preserved —
 * without this, `DrizzleCareLogRepository.upsert`'s unconditional
 * `set doneTime` would silently overwrite a previously-recorded time (e.g.
 * a backfilled "21:30") with the moment of an unrelated later edit. That
 * lookup (`careLogRepo.getBySlot`) only happens on this one path; every
 * other combination writes with zero extra reads.
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

  let doneTime: Date | null = null;
  if (input.status === "done") {
    if (input.doneTime) {
      doneTime = input.doneTime;
    } else {
      const existing = await deps.careLogRepo.getBySlot(input.careScheduleId, input.localDate, input.timeOfDay);
      // `&& existing.doneTime`, not just the status check: a `done` row whose
      // `done_time` is somehow NULL must get a time stamped on, not have that
      // NULL "preserved" — writing back `status: done` with no completion
      // time is the shape this whole branch exists to keep out of the data.
      // No current writer can produce such a row (answerCareSlot always
      // stamps, run-care-tick only writes missed+null), so this guards
      // legacy/imported rows.
      doneTime = existing?.status === "done" && existing.doneTime ? existing.doneTime : new Date();
    }
  }

  const { log, previousStatus } = await deps.careLogRepo.upsert({
    userId,
    careItemId: item.id,
    careScheduleId: input.careScheduleId,
    localDate: input.localDate,
    timeOfDay: input.timeOfDay,
    status: input.status,
    doneTime,
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
