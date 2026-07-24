import { localMinute, localParts } from "../domain/reminder-clock";
import { isActiveOn } from "../domain/care-schedule";
import type { CareItem, CareItemRepository, CareSchedule } from "../domain/care-item";
import type { CareLogRepository } from "../domain/care-log";
import type { CareOccurrenceRepository } from "../domain/care-occurrence";
import type { PushSender } from "../domain/push-sender";
import type { PushSubscriptionRepository } from "../domain/push-subscription";

/**
 * How far back (in minutes) a tick looks for a slot time it may have missed
 * (e.g. a skipped Cron invocation), on TODAY's local date only — never across
 * midnight (D4/D7 in design.md; unlike Slice-2's cross-midnight look-back).
 */
const LOOKBACK_MINUTES = 5;

export interface RunCareTickDeps {
  careItemRepo: CareItemRepository;
  careLogRepo: CareLogRepository;
  careOccurrenceRepo: CareOccurrenceRepository;
  subscriptionRepo: PushSubscriptionRepository;
  pushSender: PushSender;
}

/** Push body: dose summary for medication (when set), else the free-text note. */
function messageBody(item: CareItem): string {
  return item.dose ?? item.note ?? "";
}

/**
 * Materializes today's slot and nags: pushes when no `care_log` exists for
 * the slot and it's the first fire or the nag interval has elapsed (D4 in
 * design.md). `nagIntervalMinutes = 0` fires exactly once because the re-nag
 * branch is gated on `> 0`.
 *
 * The look-back only gates the FIRST materialization of a slot (a tick that's
 * more than `LOOKBACK_MINUTES` late for a slot that was never fired today
 * simply never materializes it — it's caught by markMissed the next day, not
 * fired late). Once an occurrence already exists, re-nagging is gated only by
 * `nagIntervalMinutes` and same-local-day, never by the original look-back
 * window — otherwise a nag interval longer than the look-back could never
 * re-fire.
 */
async function dispatchSlot(
  now: Date,
  todayLocalDate: string,
  nowMinute: number,
  item: CareItem,
  schedule: CareSchedule,
  deps: RunCareTickDeps,
): Promise<void> {
  const candidateMinute = localMinute(todayLocalDate, schedule.timeOfDay);
  if (candidateMinute > nowMinute) return; // not due yet today

  let occurrence = await deps.careOccurrenceRepo.getBySlot(schedule.id, todayLocalDate, schedule.timeOfDay);
  if (!occurrence) {
    if (candidateMinute < nowMinute - LOOKBACK_MINUTES) return; // too late to first-materialize this slot today
    occurrence = await deps.careOccurrenceRepo.upsertBySlot({
      userId: item.userId,
      careItemId: item.id,
      careScheduleId: schedule.id,
      localDate: todayLocalDate,
      timeOfDay: schedule.timeOfDay,
    });
  }

  const existingLog = await deps.careLogRepo.getBySlot(schedule.id, todayLocalDate, schedule.timeOfDay);
  if (existingLog) return; // answered — the nag stops (D4).

  const shouldNotify =
    occurrence.lastNotifiedAt === null ||
    (schedule.nagIntervalMinutes > 0 &&
      now.getTime() - occurrence.lastNotifiedAt.getTime() >= schedule.nagIntervalMinutes * 60_000);
  if (!shouldNotify) return;

  const subscriptions = await deps.subscriptionRepo.listByUser(item.userId);
  for (const subscription of subscriptions) {
    const result = await deps.pushSender.send(subscription, { title: item.title, body: messageBody(item) });
    if (result.outcome === "expired") {
      await deps.subscriptionRepo.deleteByEndpoint(item.userId, subscription.endpoint);
    }
  }
  // Only mark the slot notified when a send was actually attempted — with zero
  // subscriptions nothing was delivered, and touching it (with nag_interval=0)
  // would wrongly suppress the nag forever even once a subscription is added.
  if (subscriptions.length > 0) {
    await deps.careOccurrenceRepo.touchNotified(occurrence.id, now);
  }
}

/**
 * Marks any occurrence of `schedule` from a strictly-past local day, with no
 * log, as `missed` — insert-if-absent, so a concurrent HTTP done/skipped
 * answer is never clobbered (D7 in design.md). `listPastUnlogged` already
 * excludes slots that have a log (from a prior missed-marking or an HTTP
 * answer), so a tick's per-schedule work stays bounded to genuinely-unlogged
 * past slots rather than re-scanning all history every minute.
 */
async function markMissedForSchedule(
  todayLocalDate: string,
  item: CareItem,
  schedule: CareSchedule,
  deps: RunCareTickDeps,
): Promise<void> {
  const pastOccurrences = await deps.careOccurrenceRepo.listPastUnlogged(schedule.id, todayLocalDate);
  for (const occurrence of pastOccurrences) {
    try {
      await deps.careLogRepo.upsertIfAbsent({
        userId: item.userId,
        careItemId: item.id,
        careScheduleId: schedule.id,
        localDate: occurrence.localDate,
        timeOfDay: occurrence.timeOfDay,
        status: "missed",
        doneTime: null,
        doseQuantity: schedule.doseQuantity,
      });
    } catch {
      // Isolate: one occurrence's failure must not abort markMissed for the rest (D8).
    }
  }
}

/**
 * Use case (the Cron tick body): for each enabled schedule, materialize +
 * nag-dispatch today's due slot in the owner's local time, then mark any
 * strictly-past unanswered slot as missed. Each schedule's dispatch and
 * markMissed are isolated in their own try/catch so one schedule's failure
 * never aborts the rest of the tick (D8 in design.md).
 */
export async function runCareTick(now: Date, deps: RunCareTickDeps): Promise<void> {
  const active = await deps.careItemRepo.listActiveSchedules();

  for (const { item, schedule, timezone } of active) {
    if (!schedule.enabled) continue;

    const nowLocal = localParts(now, timezone);

    if (isActiveOn(schedule, nowLocal.date)) {
      try {
        const nowMinute = localMinute(nowLocal.date, nowLocal.hhmm);
        await dispatchSlot(now, nowLocal.date, nowMinute, item, schedule, deps);
      } catch {
        // Isolate: one schedule's failure must not abort the tick (D8).
      }
    }

    try {
      await markMissedForSchedule(nowLocal.date, item, schedule, deps);
    } catch {
      // Isolate: markMissed failing must not abort the tick (D8).
    }
  }
}
