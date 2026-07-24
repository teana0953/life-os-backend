import type { CareItemRepository } from "../domain/care-item";
import type { CareLog, CareLogRepository } from "../domain/care-log";

export interface AnswerCareSlotInput {
  careScheduleId: string;
  localDate: string;
  timeOfDay: string;
  status: "done" | "skipped";
}

export interface AnswerCareSlotDeps {
  careItemRepo: CareItemRepository;
  careLogRepo: CareLogRepository;
}

/**
 * Use case: record a slot as done/skipped (owner-scoped via the slot's
 * schedule -> item; a `null` return means no such schedule owned by
 * `userId`). Idempotent-upserts the log on the slot key — a re-answer is a
 * no-op returning the existing log (D6 in design.md). A medication item with
 * tracked stock has its stock decremented by the schedule's dose quantity,
 * clamped >= 0, but ONLY on the write that first creates the log for this
 * slot (never on a re-answer).
 */
export async function answerCareSlot(
  deps: AnswerCareSlotDeps,
  userId: string,
  input: AnswerCareSlotInput,
): Promise<CareLog | null> {
  const item = await deps.careItemRepo.getByScheduleId(input.careScheduleId);
  if (!item || item.userId !== userId) return null;
  const schedule = item.schedules.find((s) => s.id === input.careScheduleId);
  if (!schedule) return null;

  const { log, created } = await deps.careLogRepo.upsertIfAbsent({
    userId,
    careItemId: item.id,
    careScheduleId: input.careScheduleId,
    localDate: input.localDate,
    timeOfDay: input.timeOfDay,
    status: input.status,
    doneTime: input.status === "done" ? new Date() : null,
    doseQuantity: schedule.doseQuantity,
  });

  if (created && input.status === "done" && item.category === "medication" && item.stock !== null) {
    await deps.careItemRepo.decrementStock(item.id, schedule.doseQuantity);
  }

  return log;
}
