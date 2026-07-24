import { localMinute, localParts, previousLocalDate, weekdayOf, weeksSince } from "../domain/reminder-clock";
import type { PushSender } from "../domain/push-sender";
import type { PushSubscriptionRepository } from "../domain/push-subscription";
import type { ReminderOccurrenceRepository } from "../domain/reminder-occurrence";
import type { ReminderSchedule, ReminderScheduleRepository } from "../domain/reminder-schedule";

/**
 * How far back (in minutes) a tick looks for a schedule time it may have
 * missed (e.g. a skipped Cron invocation) — see D3 in
 * add-medication-reminders/design.md. A time older than this is simply never
 * materialized.
 */
const LOOKBACK_MINUTES = 5;

export interface RunReminderTickDeps {
  scheduleRepo: ReminderScheduleRepository;
  occurrenceRepo: ReminderOccurrenceRepository;
  subscriptionRepo: PushSubscriptionRepository;
  pushSender: PushSender;
}

/** Whether `schedule` is active on `localDate` (weekday selected AND the every-N-weeks interval is on — D4). */
function isActiveOn(schedule: ReminderSchedule, localDate: string): boolean {
  if (!schedule.daysOfWeek.includes(weekdayOf(localDate))) return false;
  const weeks = weeksSince(schedule.anchorDate, localDate);
  return weeks >= 0 && weeks % schedule.weekInterval === 0;
}

/**
 * Use case (the Cron tick body): for each enabled schedule, materialize any
 * occurrence due in the user's local time (with a midnight-safe look-back —
 * D3), then dispatch every pending occurrence as a Web Push, marking each
 * terminal exactly once so it never double-sends (D5/D6).
 */
export async function runReminderTick(now: Date, deps: RunReminderTickDeps): Promise<void> {
  const active = await deps.scheduleRepo.listActiveAll();

  for (const { schedule, timezone } of active) {
    if (!schedule.enabled) continue;

    const nowLocal = localParts(now, timezone);
    const nowMinute = localMinute(nowLocal.date, nowLocal.hhmm);
    const candidateDates = [nowLocal.date, previousLocalDate(nowLocal.date)];

    for (const time of schedule.times) {
      for (const candidateDate of candidateDates) {
        if (!isActiveOn(schedule, candidateDate)) continue;

        const candidateMinute = localMinute(candidateDate, time);
        if (candidateMinute > nowMinute || candidateMinute < nowMinute - LOOKBACK_MINUTES) continue;

        await deps.occurrenceRepo.upsertByDedupeKey({
          userId: schedule.userId,
          kind: schedule.category,
          dueAt: now,
          title: schedule.label,
          body: "",
          dedupeKey: `${schedule.id}|${candidateDate}|${time}`,
        });
      }
    }
  }

  const duePending = await deps.occurrenceRepo.listDuePending(now);
  for (const occurrence of duePending) {
    const subscriptions = await deps.subscriptionRepo.listByUser(occurrence.userId);
    if (subscriptions.length === 0) {
      await deps.occurrenceRepo.markSkipped(occurrence.id);
      continue;
    }

    let anySent = false;
    for (const subscription of subscriptions) {
      const result = await deps.pushSender.send(subscription, { title: occurrence.title, body: occurrence.body });
      if (result.outcome === "sent") anySent = true;
      if (result.outcome === "expired") {
        await deps.subscriptionRepo.deleteByEndpoint(occurrence.userId, subscription.endpoint);
      }
    }
    await (anySent ? deps.occurrenceRepo.markSent(occurrence.id) : deps.occurrenceRepo.markFailed(occurrence.id));
  }
}
