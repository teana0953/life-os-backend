import { localMinute, localParts } from "../../../shared-kernel/reminder-clock";
import { isActiveOn } from "../domain/care-schedule";
import type { CareItem, CareItemRepository, CareSchedule } from "../domain/care-item";
import type { CareLogRepository } from "../domain/care-log";
import type { CareOccurrence, CareOccurrenceRepository, CareSendOutcome } from "../domain/care-occurrence";
import type { PushSendResult, PushSender } from "../domain/push-sender";
import type { PushSubscriptionRepository } from "../domain/push-subscription";

/**
 * How far back (in minutes) a tick looks for a slot time it may have missed
 * (e.g. a skipped Cron invocation), on TODAY's local date only — never across
 * midnight (D4/D7 in design.md; unlike Slice-2's cross-midnight look-back).
 */
const LOOKBACK_MINUTES = 5;

/**
 * Floor on retrying a round that did not deliver (failed/expired), so a
 * persistent failure retries at most every 10 minutes instead of every tick
 * (design D11). Bigger than either existing nag value (5, 10) so a failing
 * slot is never noisier than a healthy one; small enough to retry several
 * times an hour.
 */
const RETRY_INTERVAL_MINUTES = 10;

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
 * Whether the next attempt for `occurrence` is due (design D11): a slot never
 * attempted is always due (also avoids `null.getTime()` — a first-materialize
 * that threw here would be silently swallowed by D8's `catch {}`). Otherwise
 * the basis/interval/floor depend on the *last* attempt's outcome — see the
 * three-branch table in design.md D11.
 */
function shouldNotify(occurrence: CareOccurrence, schedule: CareSchedule, now: Date): boolean {
  if (occurrence.lastAttemptAt === null) return true;

  if (occurrence.lastSendOutcome === "sent") {
    // Unchanged pre-existing semantics: nag_interval_minutes = 0 fires once.
    // `lastNotifiedAt` is non-null for a 'sent' row by construction of
    // `recordAttempt`, but `last_send_outcome` is bare text with no CHECK and
    // this change exists to be hand-queried (and so hand-edited): falling back
    // beats throwing into D8's `catch {}`, which would silently stop this
    // user's reminders for the rest of the day.
    const basis = occurrence.lastNotifiedAt ?? occurrence.lastAttemptAt;
    return schedule.nagIntervalMinutes > 0 && now.getTime() - basis.getTime() >= schedule.nagIntervalMinutes * 60_000;
  }

  if (occurrence.lastSendOutcome === "no_subscriptions") {
    // Unconditionally due (D12). Before this change a zero-subscription round
    // wrote nothing at all, so `lastNotifiedAt` stayed null and every tick was
    // due — a user who grants push at 09:01 gets the 09:00 reminder at once.
    // Recording the outcome must not turn that into "wait out a nag interval
    // you were never notified for" — that is the very symptom being fixed.
    // Cost is identical to pre-change: one `listByUser` read per tick while
    // subscription-less, no extra push, and no extra write (the skip-write
    // guard in `dispatchSlot` still collapses repeats to a single UPDATE).
    return true;
  }

  // failed / expired: floor applies, and NOT gated by `nagIntervalMinutes > 0` —
  // that gate is for "fire once" semantics on a successful send, not retries (D11).
  const intervalMinutes = Math.max(schedule.nagIntervalMinutes, RETRY_INTERVAL_MINUTES);
  return now.getTime() - occurrence.lastAttemptAt.getTime() >= intervalMinutes * 60_000;
}

/**
 * Aggregates one round's per-subscription send results into the occurrence-level
 * outcome/detail recorded via `recordAttempt` (D10/D13 in design.md). Only called
 * with at least one subscription — zero subscriptions is handled separately as
 * `no_subscriptions` (D12).
 */
function summarizeOutcome(results: PushSendResult[]): { outcome: CareSendOutcome; detail: string | null; delivered: boolean } {
  const sentCount = results.filter((r) => r.outcome === "sent").length;
  const expiredCount = results.filter((r) => r.outcome === "expired").length;
  const failedCount = results.length - sentCount - expiredCount;

  const delivered = sentCount > 0; // Partial success counts as delivered (D10) — the user already got it.
  const outcome: CareSendOutcome = delivered ? "sent" : expiredCount > 0 && failedCount === 0 ? "expired" : "failed";

  // A round with nothing to report carries no detail, however many subscriptions
  // it covered: `last_send_detail IS NOT NULL` is the triage query, so a healthy
  // multi-device row must not show up in it.
  if (failedCount + expiredCount === 0) return { outcome, detail: null, delivered };

  if (results.length === 1) return { outcome, detail: results[0].detail ?? null, delivered };

  // Multiple subscriptions: detail carries this round's counts, plus the first
  // non-`sent` subscription's detail (D13) — otherwise "one device OK, one
  // failing" would record indistinguishably from "all OK".
  const counts: string[] = [];
  if (sentCount > 0) counts.push(`sent=${sentCount}`);
  if (failedCount > 0) counts.push(`failed=${failedCount}`);
  if (expiredCount > 0) counts.push(`expired=${expiredCount}`);
  const firstFailureDetail = results.find((r) => r.outcome !== "sent")?.detail;
  const detail = [counts.join(" "), firstFailureDetail].filter(Boolean).join(" ") || null;

  return { outcome, detail, delivered };
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

  if (!shouldNotify(occurrence, schedule, now)) return;

  const subscriptions = await deps.subscriptionRepo.listByUser(item.userId);

  if (subscriptions.length === 0) {
    // Distinguishable from a send failure (D12/D13) — but only written when
    // the outcome actually changed, else a nag_interval=0 slot (due every
    // tick against `lastAttemptAt`) would cost one UPDATE per minute for as
    // long as it stays subscription-less.
    if (occurrence.lastSendOutcome !== "no_subscriptions") {
      await deps.careOccurrenceRepo.recordAttempt(occurrence.id, { at: now, outcome: "no_subscriptions", detail: null, delivered: false });
    }
    return;
  }

  const results: PushSendResult[] = [];
  for (const subscription of subscriptions) {
    const result = await deps.pushSender.send(subscription, { title: item.title, body: messageBody(item) });
    results.push(result);
    if (result.outcome === "expired") {
      await deps.subscriptionRepo.deleteByEndpoint(item.userId, subscription.endpoint);
    }
  }

  const { outcome, detail, delivered } = summarizeOutcome(results);
  await deps.careOccurrenceRepo.recordAttempt(occurrence.id, { at: now, outcome, detail, delivered });
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
