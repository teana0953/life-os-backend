import { localMinute, localParts, nextLocalMidnightInstant, utcInstantFor } from "../../../shared-kernel/reminder-clock";
import type { CareItem, CareItemRepository, CareSchedule } from "../domain/care-item";
import type { CareLogRepository } from "../domain/care-log";
import type { CareOccurrence, CareOccurrenceRepository, CareSendOutcome } from "../domain/care-occurrence";
import type { PushSendResult, PushSender } from "../domain/push-sender";
import type { PushSubscriptionRepository } from "../domain/push-subscription";

/**
 * How late a slot's first materialization may run behind its scheduled time
 * and still fire (gate_decision #2 in replace-cron-with-workflows/design.md
 * — 10, not this repo's earlier 30-minute draft: a medication reminder that
 * arrives 25 minutes late can be worse than one that never arrives). This
 * gate applies ONLY to a slot that has never been materialized today — see
 * `dispatchSlot`. It must never be consulted again once an occurrence
 * exists; that path's throttling is `RETRY_INTERVAL_MINUTES` /
 * `nagIntervalMinutes` instead (gate_decision #3 — the two gates are
 * deliberately kept apart so an abandoned claim can still be retried after
 * this window has long closed).
 */
const FIRST_FIRE_GRACE_MINUTES = 10;

/**
 * Two roles, both gate_decision-mandated and by design the same number:
 * (1) the floor on retrying a round that did not deliver (failed/expired/
 * no_subscriptions/an abandoned claim), so a persistent failure retries at
 * most every 10 minutes; (2) the *lease* length for `claimAttempt` — a claim
 * older than this is presumed abandoned (the claimant crashed after winning
 * but before recording an outcome) and may be retaken. Sharing one constant
 * is intentional: a claim that is still within its lease is, by definition,
 * not yet due for a retry either.
 */
const RETRY_INTERVAL_MINUTES = 10;

export interface RunCareDayDeps {
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
 * The next instant `occurrence` becomes due for another attempt, or `null`
 * if it is terminated for today (a successful send with `nagIntervalMinutes
 * = 0`). The single source of truth for the three-branch nag semantics —
 * both `shouldNotify` (is it due *now*?) and `planNextWake` (when will it
 * next be due?) call this, so the two can never drift apart.
 *
 * A slot never attempted is always due (`lastAttemptAt === null`); this also
 * sidesteps `null.getTime()` for a first-materialize that threw here, which
 * D8's per-schedule `catch {}` would otherwise swallow silently.
 */
function nextDueAt(occurrence: CareOccurrence, schedule: CareSchedule): Date | null {
  if (occurrence.lastAttemptAt === null) return new Date(0);

  if (occurrence.lastSendOutcome === "sent") {
    // Unchanged pre-existing semantics: nag_interval_minutes = 0 fires once.
    if (schedule.nagIntervalMinutes <= 0) return null;
    const basis = occurrence.lastNotifiedAt ?? occurrence.lastAttemptAt;
    return new Date(basis.getTime() + schedule.nagIntervalMinutes * 60_000);
  }

  if (occurrence.lastSendOutcome === "no_subscriptions") {
    // D12 revised for the Workflows architecture: the old per-minute cron
    // tick made "unconditionally due" free (a subscribe at 09:01 got the
    // 09:00 reminder within the same minute for no extra cost). An instance
    // that only wakes on a schedule cannot do that without busy-looping —
    // instead it re-wakes at the ordinary retry cadence. Near-instant
    // delivery after a genuine subscribe is instead achieved by
    // `subscribeWebPush` calling `CareOccurrenceRepository.
    // expediteNoSubscriptionsRetry`, which rewinds THIS occurrence's
    // `lastAttemptAt` before this function ever runs again — restarting the
    // Workflows instance alone does not change what this branch returns,
    // since it only re-reads unchanged occurrence rows.
    return new Date(occurrence.lastAttemptAt.getTime() + RETRY_INTERVAL_MINUTES * 60_000);
  }

  // failed / expired / an abandoned claim (lastSendOutcome still null because
  // a claim was won but the round crashed before recordAttempt) all retry at
  // the same floor, NOT gated by `nagIntervalMinutes > 0` — that gate is for
  // "fire once" semantics on a successful send, not retries.
  const intervalMinutes = Math.max(schedule.nagIntervalMinutes, RETRY_INTERVAL_MINUTES);
  return new Date(occurrence.lastAttemptAt.getTime() + intervalMinutes * 60_000);
}

/**
 * Aggregates one round's per-subscription send results into the occurrence-level
 * outcome/detail recorded via `recordAttempt` (D10/D13 in add-medication-reminders
 * design.md). Only called with at least one subscription — zero subscriptions is
 * handled separately as `no_subscriptions` (D12).
 */
function summarizeOutcome(results: PushSendResult[]): { outcome: CareSendOutcome; detail: string | null; delivered: boolean } {
  const sentCount = results.filter((r) => r.outcome === "sent").length;
  const expiredCount = results.filter((r) => r.outcome === "expired").length;
  const failedCount = results.length - sentCount - expiredCount;

  const delivered = sentCount > 0; // Partial success counts as delivered (D10) — the user already got it.
  const outcome: CareSendOutcome = delivered ? "sent" : expiredCount > 0 && failedCount === 0 ? "expired" : "failed";

  if (failedCount + expiredCount === 0) return { outcome, detail: null, delivered };
  if (results.length === 1) return { outcome, detail: results[0].detail ?? null, delivered };

  const counts: string[] = [];
  if (sentCount > 0) counts.push(`sent=${sentCount}`);
  if (failedCount > 0) counts.push(`failed=${failedCount}`);
  if (expiredCount > 0) counts.push(`expired=${expiredCount}`);
  const firstFailureDetail = results.find((r) => r.outcome !== "sent")?.detail;
  const detail = [counts.join(" "), firstFailureDetail].filter(Boolean).join(" ") || null;

  return { outcome, detail, delivered };
}

/**
 * Materializes today's slot (if not yet due, or too late to first-fire — see
 * `FIRST_FIRE_GRACE_MINUTES`) and, when due, claims and dispatches this
 * round. `claimAttempt` (gate_decision #1) is the atomic guard against a
 * Workflows step replay double-sending: only the caller that wins the claim
 * proceeds to send; a lost claim (still within another attempt's lease)
 * returns without touching the push sender.
 */
async function dispatchSlot(
  now: Date,
  todayLocalDate: string,
  nowMinute: number,
  item: CareItem,
  schedule: CareSchedule,
  deps: RunCareDayDeps,
): Promise<void> {
  const candidateMinute = localMinute(todayLocalDate, schedule.timeOfDay);
  if (candidateMinute > nowMinute) return; // not due yet today

  let occurrence = await deps.careOccurrenceRepo.getBySlot(schedule.id, todayLocalDate, schedule.timeOfDay);
  if (!occurrence) {
    // FIRST_FIRE_GRACE_MINUTES gates ONLY this branch — a slot that has never
    // been materialized today. Once materialized, this check is never
    // consulted again (gate_decision #3): re-nag/retry timing is entirely
    // `nextDueAt`'s job.
    if (candidateMinute < nowMinute - FIRST_FIRE_GRACE_MINUTES) return;
    occurrence = await deps.careOccurrenceRepo.upsertBySlot({
      userId: item.userId,
      careItemId: item.id,
      careScheduleId: schedule.id,
      localDate: todayLocalDate,
      timeOfDay: schedule.timeOfDay,
    });
  }

  const existingLog = await deps.careLogRepo.getBySlot(schedule.id, todayLocalDate, schedule.timeOfDay);
  if (existingLog) return; // answered — the nag stops.

  const due = nextDueAt(occurrence, schedule);
  if (due === null || now.getTime() < due.getTime()) return; // not due.

  // The claim's lease is derived from the SAME interval `due` was just
  // computed from (nag for a successful send, RETRY_INTERVAL_MINUTES
  // otherwise) — not a flat RETRY_INTERVAL_MINUTES constant. A flat 10-minute
  // lease would silently swallow every re-nag whose own interval is shorter
  // than 10 (nag = 5 is a real configured value), since the previous
  // (already-resolved) attempt would still look "within lease" to a fixed
  // 10-minute window. Deriving it from `due` keeps the claim exactly as
  // permissive as the due-check that just passed, while still catching a
  // genuine concurrent/replayed claim of THIS SAME round (whose `at` has not
  // moved past `due` at all).
  const leaseMinutes = occurrence.lastAttemptAt === null ? 0 : (due.getTime() - occurrence.lastAttemptAt.getTime()) / 60_000;
  const won = await deps.careOccurrenceRepo.claimAttempt(occurrence.id, { at: now, leaseMinutes });
  if (!won) return; // a concurrent/replayed round already owns this attempt within its lease.

  const subscriptions = await deps.subscriptionRepo.listByUser(item.userId);

  if (subscriptions.length === 0) {
    await deps.careOccurrenceRepo.recordAttempt(occurrence.id, { at: now, outcome: "no_subscriptions", detail: null, delivered: false });
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
 * answer is never clobbered.
 */
async function markMissedForSchedule(todayLocalDate: string, item: CareItem, schedule: CareSchedule, deps: RunCareDayDeps): Promise<void> {
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
      // Isolate: one occurrence's failure must not abort markMissed for the rest.
    }
  }
}

/**
 * Runs once per instance-day, at the start of a `CareReminderWorkflow`
 * instance's run (before its wake/dispatch loop): marks any strictly-past
 * unanswered slot, across all of `userId`'s enabled schedules, as missed.
 * Unlike `dispatchDueRounds` this is NOT scoped to today's active schedules
 * — a schedule inactive today (wrong weekday, off week-interval) can still
 * have past occurrences from a day it WAS active that need marking.
 */
export async function markMissedForUserDay(userId: string, todayLocalDate: string, deps: RunCareDayDeps): Promise<void> {
  const items = await deps.careItemRepo.listByUser(userId);
  for (const item of items) {
    for (const schedule of item.schedules) {
      if (!schedule.enabled) continue;
      try {
        await markMissedForSchedule(todayLocalDate, item, schedule, deps);
      } catch {
        // Isolate: one schedule's failure must not abort the rest.
      }
    }
  }
}

/**
 * Runs on every wake of a `CareReminderWorkflow` instance: for each of
 * `userId`'s schedules active today (per `isActiveOn`, joined by
 * `listActiveSchedulesForUserOn`), materialize/nag-dispatch the due slot.
 * Each schedule is isolated in its own try/catch so one schedule's failure
 * never aborts the rest of the round.
 *
 * D1' (design.md): recomputes everything from `now` and the current DB state
 * on every call — never trusts a value computed before the instance slept.
 */
export async function dispatchDueRounds(now: Date, userId: string, timeZone: string, deps: RunCareDayDeps): Promise<void> {
  const { date: todayLocalDate, hhmm } = localParts(now, timeZone);
  const nowMinute = localMinute(todayLocalDate, hhmm);
  const active = await deps.careItemRepo.listActiveSchedulesForUserOn(userId, todayLocalDate);

  for (const { item, schedule } of active) {
    try {
      await dispatchSlot(now, todayLocalDate, nowMinute, item, schedule, deps);
    } catch {
      // Isolate: one schedule's failure must not abort the round.
    }
  }
}

/** One schedule's materialize/log state for `planNextWake` — see `buildSlotSnapshots`. */
export interface SlotSnapshot {
  schedule: CareSchedule;
  /** `null` = not yet materialized today. */
  occurrence: CareOccurrence | null;
  /** Whether a `care_log` already exists for this slot today — a logged slot is terminated, no future wake needed. */
  answered: boolean;
}

/**
 * The next UTC instant a `CareReminderWorkflow` instance should wake for, or
 * `null` when `todayLocalDate` (the day this instance owns) has rolled past
 * in `timeZone` — the loop's exit signal to stop waking and hand off to
 * spawning tomorrow's instance (W1 in design.md).
 *
 * Pure function: `slots` must already reflect the current DB state (fetched
 * by `buildSlotSnapshots` just before calling this) — this never itself
 * reads the clock forward or reuses a stale computation, per D1'.
 */
export function planNextWake(now: Date, timeZone: string, todayLocalDate: string, slots: SlotSnapshot[]): Date | null {
  const nowParts = localParts(now, timeZone);
  if (nowParts.date !== todayLocalDate) return null;
  const nowMinute = localMinute(todayLocalDate, nowParts.hhmm);

  const candidates: number[] = [nextLocalMidnightInstant(now, timeZone).getTime()];

  for (const { schedule, occurrence, answered } of slots) {
    if (answered) continue;

    if (!occurrence) {
      // Mirrors dispatchSlot's own not-yet-materialized gate exactly (same
      // candidateMinute/nowMinute/FIRST_FIRE_GRACE_MINUTES check) so the two
      // can never disagree about whether this slot is still alive. A future
      // first-fire needs a wake at its own instant; a past-due but
      // still-within-grace first-fire ALSO needs a wake — this branch can run
      // as an instance's very first plan-next-wake, before any dispatch round
      // has ever touched this slot (restartToday/subscribeWebPush spin up a
      // fresh instance mid-day), so "already past" does not imply "already
      // dispatched" here. Wake immediately (`now`) so the next
      // dispatch-due-rounds still lands inside the grace window; once the
      // window has closed the slot is dead for today — markMissed picks it up
      // tomorrow.
      const candidateMinute = localMinute(todayLocalDate, schedule.timeOfDay);
      if (candidateMinute < nowMinute - FIRST_FIRE_GRACE_MINUTES) continue; // grace window closed — dead for today.
      const slotInstantMs = utcInstantFor(todayLocalDate, schedule.timeOfDay, timeZone).getTime();
      candidates.push(Math.max(slotInstantMs, now.getTime()));
      continue;
    }

    const due = nextDueAt(occurrence, schedule);
    if (due !== null) candidates.push(due.getTime());
  }

  return new Date(Math.min(...candidates));
}

/** One schedule's current-day state, read fresh from the repositories — the I/O half of `planNextWake`. */
export async function buildSlotSnapshots(
  userId: string,
  timeZone: string,
  now: Date,
  deps: RunCareDayDeps,
): Promise<{ todayLocalDate: string; slots: SlotSnapshot[] }> {
  const todayLocalDate = localParts(now, timeZone).date;
  const active = await deps.careItemRepo.listActiveSchedulesForUserOn(userId, todayLocalDate);

  const slots: SlotSnapshot[] = [];
  for (const { schedule } of active) {
    const [occurrence, log] = await Promise.all([
      deps.careOccurrenceRepo.getBySlot(schedule.id, todayLocalDate, schedule.timeOfDay),
      deps.careLogRepo.getBySlot(schedule.id, todayLocalDate, schedule.timeOfDay),
    ]);
    slots.push({ schedule, occurrence, answered: log !== null });
  }

  return { todayLocalDate, slots };
}
