import { describeErrorChain } from "../../../shared-kernel/error-logging";
import { localMinute, localParts, nextLocalMidnightInstant, utcInstantFor } from "../../../shared-kernel/reminder-clock";
import type { CareItem, CareItemRepository, CareSchedule } from "../domain/care-item";
import type { CareLogRepository } from "../domain/care-log";
import type { CareOccurrence, CareOccurrenceRepository, CareSendOutcome } from "../domain/care-occurrence";
import { hashAckToken, mintAckToken } from "../domain/ack-token";
import type { PushDeliveryRegistration, PushDeliveryRepository } from "../domain/push-delivery";
import type { PushSendResult, PushSender } from "../domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository } from "../domain/push-subscription";

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
 * no_subscriptions), so a persistent failure retries at most every 10 minutes;
 * (2) the *lease* length for `claimAttempt` on those same rounds — a claim
 * older than this is presumed abandoned (the claimant crashed after winning
 * but before recording an outcome) and may be retaken. Sharing one constant
 * is intentional: a claim that is still within its lease is, by definition,
 * not yet due for a retry either. An abandoned claim — an attempt with NO
 * recorded outcome — is the one case split out of this pair, onto the shorter
 * `ABANDONED_CLAIM_RETRY_MINUTES` floor and lease.
 */
const RETRY_INTERVAL_MINUTES = 10;

/**
 * Retry floor — and, because `dispatchSlot` derives the claim lease from the
 * same `due`, the re-claim lease — for an *abandoned claim*: an occurrence with
 * an attempt time and no recorded outcome, i.e. a round that won the claim and
 * then died before recording anything.
 *
 * Why 2 and not 1 or 10: the lease is the only thing stopping a round that is
 * still in flight from being re-claimed underneath itself and double-sending. A
 * Workers invocation has a hard CPU ceiling far below two minutes of wall clock,
 * so a round still alive after two minutes is already lost; one minute narrows
 * that margin for no user-visible benefit. Ten — the value this branch used to
 * inherit from `RETRY_INTERVAL_MINUTES` — is the number that produced the
 * measured ten-minute-late 16:15 medication reminder.
 */
const ABANDONED_CLAIM_RETRY_MINUTES = 2;

/**
 * The unconditional writes one slot's dispatch issues before any per-subscription
 * send: `upsertBySlot`, `claimAttempt`, `registerSent`, `recordAttempt`. Fixed
 * regardless of subscription count — each of these four is a single statement,
 * `registerSent` included (it takes the whole round's registrations in one
 * batch insert), so nothing here scales with `subscriptions.length` (design.md
 * D4).
 */
const SLOT_DISPATCH_WRITES = 4;

/**
 * Worst case for ONE subscription's send in `sendClaimedSlot`'s loop: one
 * subrequest for the push send itself, plus one more for
 * `subscriptionRepo.deleteByEndpoint` if that send comes back `expired`
 * (design.md D4). Both must be reserved before a send — the headroom check
 * runs first, so it cannot yet know which outcome the send will get. Checked
 * per send, never multiplied by `subscriptions.length`: a slot's total dispatch
 * cost does scale with its subscription count, but the gate that decides
 * whether to *start* a slot must not — see `SLOT_TAIL_RESERVE` for how the loop
 * itself stays inside budget as the count grows.
 */
const PER_SUBSCRIPTION_WORST_CASE = 2;

/** Reserve for the failure-recording write in `dispatchSlot`'s catch (D5). */
const FAILURE_RECORD_RESERVE = 1;

/**
 * Reserve kept back throughout `sendClaimedSlot`'s per-subscription loop for
 * the `recordAttempt` write that always follows the loop — whether the loop
 * ran to completion or stopped early for budget — plus, if that best-effort
 * write itself fails, `FAILURE_RECORD_RESERVE`'s fallback in `dispatchSlot`'s
 * catch. Checked before every send alongside `PER_SUBSCRIPTION_WORST_CASE`, so
 * a slot that starts sending is always guaranteed to end with a recorded
 * outcome instead of being cut off mid-round by the platform (design.md D4).
 */
const SLOT_TAIL_RESERVE = 1 + FAILURE_RECORD_RESERVE;

/** Retiring one orphan is a single `upsertIfAbsent` (D7). */
const ORPHAN_RETIREMENT_WRITES = 1;

/** Longest `last_send_detail` this path writes — a diagnostic, not a log sink. */
const MAX_FAILURE_DETAIL_LENGTH = 500;

/**
 * The diagnostic recorded on (and logged for) a dispatch that threw after
 * winning its claim.
 *
 * `describeErrorChain` already redacts DB row data. The two extra strips are for
 * this path specifically: a push-sender failure names the subscription endpoint
 * it was posting to, and a Web Push error can carry the subscription keys or an
 * ack token — all device-identifying material that must not land in
 * `care_occurrence.last_send_detail` or in a log line.
 */
function failureDetail(err: unknown): string {
  const described = JSON.stringify(describeErrorChain(err)) ?? String(err);
  const redacted = described.replace(/https?:\/\/[^\s"'\\]+/gi, "[redacted-url]").replace(/[A-Za-z0-9_-]{20,}/g, "[redacted-token]");
  return redacted.length > MAX_FAILURE_DETAIL_LENGTH ? `${redacted.slice(0, MAX_FAILURE_DETAIL_LENGTH)}\u2026` : redacted;
}

export interface RunCareDayDeps {
  careItemRepo: CareItemRepository;
  careLogRepo: CareLogRepository;
  careOccurrenceRepo: CareOccurrenceRepository;
  subscriptionRepo: PushSubscriptionRepository;
  pushSender: PushSender;
  /**
   * Required, deliberately not optional: an optional one would give this file
   * a second, silent path where reminders go out and no delivery is ever
   * recorded — indistinguishable, in the data, from a fleet that never acks.
   */
  pushDeliveryRepo: PushDeliveryRepository;
  /**
   * Subrequests still available in the caller's per-invocation budget, or
   * `null` when no budget is in force (unlimited).
   *
   * A port rather than a direct import of `shared/db/subrequest-budget`: the
   * dependency rule keeps `application/` out of `shared/`, and the counting
   * store is established by the adapter that owns the invocation
   * (`care-reminder-loop`'s per-step scope), not by this layer.
   *
   * Required, deliberately not optional-defaulting-to-unlimited: a default
   * would let a wiring mistake silently disable the brake on the one path that
   * exists to have it, and look exactly like a round that simply had headroom.
   */
  remainingSubrequestBudget: () => number | null;
}

/**
 * Whether the current subrequest scope can still afford `cost` more of them.
 *
 * `null` (no scope in force) means unlimited — every caller outside a
 * `withSubrequestBudget` scope, HTTP paths and most tests included, therefore
 * behaves exactly as it did before this brake existed.
 */
function hasHeadroomFor(deps: RunCareDayDeps, cost: number): boolean {
  const remaining = deps.remainingSubrequestBudget();
  return remaining === null || remaining >= cost;
}

/**
 * RFC8030 5.2 `TTL` for this slot's push, in seconds.
 *
 * With a nag, the next nag is a REPLACEMENT for this message, not an addition
 * to it, so holding this one past that point can only produce a pile-up on a
 * phone that comes back online. TTL <= the nag interval buys the invariant
 * "at most one live copy of a given slot sits in the push service at a time".
 * (That invariant survives delivery acks only because an ack changes no
 * dispatch decision at all — see `recordPushAck`; if acking ever gates a nag,
 * re-derive this.)
 *
 * Without a nag the slot fires exactly once, so the ceiling has to come from
 * how late this repo already says a reminder may usefully arrive: that number
 * is `FIRST_FIRE_GRACE_MINUTES` (gate_decision #2 — a medication reminder
 * 25 minutes late can be worse than none). Reusing it keeps ONE definition of
 * "acceptably late" instead of inventing a second.
 */
function pushTtlSecondsFor(schedule: CareSchedule): number {
  const minutes = schedule.nagIntervalMinutes > 0 ? schedule.nagIntervalMinutes : FIRST_FIRE_GRACE_MINUTES;
  return minutes * 60;
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

  if (occurrence.lastSendOutcome === null) {
    // An abandoned claim: a round won the claim and never recorded anything.
    // Deliberately AHEAD of the failed/expired case and not gated by
    // `nagIntervalMinutes` — a round that reported nothing is not evidence of a
    // persistent failure, so it must not inherit that floor (design.md D6).
    return new Date(occurrence.lastAttemptAt.getTime() + ABANDONED_CLAIM_RETRY_MINUTES * 60_000);
  }

  // failed / expired retry at the same floor, NOT gated by
  // `nagIntervalMinutes > 0` — that gate is for "fire once" semantics on a
  // successful send, not retries.
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
 * The slot key `(careScheduleId, timeOfDay)` — within one local day this is
 * exactly the key `getBySlot` looks a row up by, which is what lets a caller
 * replace a per-schedule `getBySlot` with one batch read plus an in-memory
 * lookup (design.md D1).
 */
function slotKey(careScheduleId: string, timeOfDay: string): string {
  return `${careScheduleId}|${timeOfDay}`;
}

function indexBySlot<T extends { careScheduleId: string; timeOfDay: string }>(rows: T[]): Map<string, T> {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(slotKey(row.careScheduleId, row.timeOfDay), row);
  return byKey;
}

/**
 * One slot's share of the round-level state `dispatchDueRounds` has already
 * read in batch. Handed to `dispatchSlot` instead of letting it read per slot,
 * so a round's read count no longer grows with the schedule count (design.md
 * D1). Writes are deliberately NOT batched with it (D2).
 */
interface RoundSlotState {
  /** `null` = not yet materialized today. */
  occurrence: CareOccurrence | null;
  /** Whether a `care_log` already exists for this slot today. */
  answered: boolean;
  /**
   * The round's subscription list, shared by every slot and mutated in place
   * when a send comes back `expired`. Shared rather than copied per slot
   * because the pre-batch code re-read the list for each slot and so never
   * sent to an endpoint an earlier slot in the same round had just pruned.
   */
  subscriptions: PushSubscription[];
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
  slotState: RoundSlotState,
  deps: RunCareDayDeps,
): Promise<void> {
  const candidateMinute = localMinute(todayLocalDate, schedule.timeOfDay);
  if (candidateMinute > nowMinute) return; // not due yet today

  let occurrence = slotState.occurrence;
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

  if (slotState.answered) return; // answered — the nag stops.

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

  try {
    await sendClaimedSlot(now, item, schedule, occurrence, slotState, deps);
  } catch (err) {
    // Best-effort (D5): move the occurrence off the abandoned-claim state and
    // onto the ordinary failed-round floor, so a round that ran and failed is
    // distinguishable in the data from one that reported nothing. If THIS write
    // fails too — the likely case when the cause was budget exhaustion — the
    // occurrence stays an abandoned claim and `ABANDONED_CLAIM_RETRY_MINUTES`
    // picks it up instead; the two mechanisms deliberately cover each other.
    try {
      await deps.careOccurrenceRepo.recordAttempt(occurrence.id, { at: now, outcome: "failed", detail: failureDetail(err), delivered: false });
    } catch {
      // intentionally ignored — see above.
    }
    throw err;
  }
}

/** The part of a slot's dispatch that runs after its claim has been won. */
async function sendClaimedSlot(
  now: Date,
  item: CareItem,
  schedule: CareSchedule,
  occurrence: CareOccurrence,
  slotState: RoundSlotState,
  deps: RunCareDayDeps,
): Promise<void> {
  const subscriptions = slotState.subscriptions;

  if (subscriptions.length === 0) {
    await deps.careOccurrenceRepo.recordAttempt(occurrence.id, { at: now, outcome: "no_subscriptions", detail: null, delivered: false });
    return;
  }

  // One token per (occurrence x subscription): the payload is encrypted per
  // subscription, so two devices necessarily receive two different tokens —
  // that is what makes an ack say WHICH device got it, and what stops one
  // device's ack from speaking for another's.
  const ttlSeconds = pushTtlSecondsFor(schedule);
  const dispatches = subscriptions.map((subscription) => ({ subscription, ackToken: mintAckToken() }));
  const registrations: PushDeliveryRegistration[] = await Promise.all(
    dispatches.map(async ({ subscription, ackToken }) => ({
      careOccurrenceId: occurrence.id,
      pushSubscriptionId: subscription.id,
      tokenHash: await hashAckToken(ackToken),
      sentAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    })),
  );
  // Before the first send, never after: a device can display the notification
  // and POST its ack while this round is still running, and an ack that finds
  // no row is silently lost. Registered for every subscription up front, even
  // ones the budget check below may end up skipping — it is one batch insert
  // either way, so nothing scales with how many sends actually happen, and a
  // registered-but-unsent row is simply never acked.
  //
  // Swallowed, never rethrown: bookkeeping must not be able to block a
  // medication reminder. The claim above has already been taken, so an
  // exception escaping here would skip both the sends and recordAttempt,
  // leaving the occurrence looking like an abandoned claim — the next retry
  // is a full nag interval (>= 10 minutes) away. Neon has been observed
  // returning intermittent 520s and losing in-flight fetches to a Workers CPU
  // limit, so this is a real transient, and losing this round's acks
  // under-reports delivery exactly the way the rest of the design already
  // accepts.
  try {
    await deps.pushDeliveryRepo.registerSent(registrations);
  } catch {
    // intentionally ignored — see above.
  }

  const results: PushSendResult[] = [];
  for (const { subscription, ackToken } of dispatches) {
    // Checked before EVERY send, not once for the whole slot: a fleet large
    // enough to run the round out of budget mid-loop must not be allowed to
    // reach the platform's own subrequest ceiling and lose the rest of the
    // round (sends, recordAttempt, everything) with nothing recorded. Stopping
    // here instead leaves `SLOT_TAIL_RESERVE` untouched, so the recordAttempt
    // below always has room to run — this round ends as a partial delivery
    // with a recorded outcome, never as an unstarted or an abandoned slot.
    if (!hasHeadroomFor(deps, PER_SUBSCRIPTION_WORST_CASE + SLOT_TAIL_RESERVE)) {
      console.warn(
        `care-dispatch: stopped mid-slot after ${results.length}/${dispatches.length} sends, subrequest budget exhausted`,
        { careOccurrenceId: occurrence.id },
      );
      break;
    }
    const result = await deps.pushSender.send(subscription, {
      title: item.title,
      body: messageBody(item),
      data: { ack: ackToken },
      ttlSeconds,
      // RFC8030 5.3 lists "incoming call or alert" against `high`, for a
      // device in a low-battery state. It says nothing about FCM priority or
      // Android Doze, and neither does anything else authoritative we found —
      // do not claim an effect there.
      urgency: "high",
    });
    results.push(result);
    if (result.outcome === "expired") {
      await deps.subscriptionRepo.deleteByEndpoint(item.userId, subscription.endpoint);
      // Also drop it from the round's shared list: the list is read once per
      // round now, so without this a later slot in the SAME round would still
      // push to an endpoint this one just proved gone.
      const pruned = subscriptions.indexOf(subscription);
      if (pruned !== -1) subscriptions.splice(pruned, 1);
    }
  }

  const { outcome, detail, delivered } = summarizeOutcome(results);
  await deps.careOccurrenceRepo.recordAttempt(occurrence.id, { at: now, outcome, detail, delivered });
}

/**
 * Runs once per instance-day, at the start of a `CareReminderWorkflow`
 * instance's run (before its wake/dispatch loop): marks any strictly-past
 * unanswered slot, across all of `userId`'s enabled schedules, as missed.
 * Unlike `dispatchDueRounds` this is NOT scoped to today's active schedules
 * — a schedule inactive today (wrong weekday, off week-interval) can still
 * have past occurrences from a day it WAS active that need marking.
 *
 * Two reads, whatever the schedule count: the user's items and, once,
 * `listPastUnloggedForUser` (design.md D1). The enabled-only restriction that
 * used to come from skipping disabled schedules before their own
 * `listPastUnlogged` call is applied here in the application layer instead, so
 * it stays the same rule rather than moving into SQL.
 *
 * Isolation trade-off (design.md D1): the old per-schedule loop wrapped each
 * schedule's own `listPastUnlogged` in try/catch, so one read failure never
 * lost the rest. Batching into these two calls makes that impossible — there
 * is no longer a per-schedule read to isolate. A failure here is left to
 * propagate to the caller's `step.do("mark-missed", ...)`, which Workflows
 * retries at the step level; that is coarser than before (the whole pass
 * retries, not just the one schedule that failed) but is not silent, unlike
 * swallowing it here would be. Nothing marked this pass is lost even if every
 * retry fails: `listPastUnloggedForUser` is "every strictly-past unanswered
 * occurrence", not "yesterday's", so the next instance-day's own `mark-missed`
 * sweeps it up — late, never dropped.
 */
export async function markMissedForUserDay(userId: string, todayLocalDate: string, deps: RunCareDayDeps): Promise<void> {
  const [items, pastUnlogged] = await Promise.all([
    deps.careItemRepo.listByUser(userId),
    deps.careOccurrenceRepo.listPastUnloggedForUser(userId, todayLocalDate),
  ]);

  const enabledSchedules = new Map<string, { item: CareItem; schedule: CareSchedule }>();
  for (const item of items) {
    for (const schedule of item.schedules) {
      if (schedule.enabled) enabledSchedules.set(schedule.id, { item, schedule });
    }
  }

  for (const occurrence of pastUnlogged) {
    // No entry = the occurrence belongs to a disabled (or deleted) schedule:
    // the same slots the per-schedule scan skipped by never calling for them.
    const owner = enabledSchedules.get(occurrence.careScheduleId);
    if (!owner) continue;
    try {
      await deps.careLogRepo.upsertIfAbsent({
        userId: owner.item.userId,
        careItemId: owner.item.id,
        careScheduleId: owner.schedule.id,
        localDate: occurrence.localDate,
        timeOfDay: occurrence.timeOfDay,
        status: "missed",
        doneTime: null,
        doseQuantity: owner.schedule.doseQuantity,
      });
    } catch {
      // Isolate: one occurrence's failure must not abort markMissed for the rest.
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
  // Four reads for the whole round, whatever the schedule count (design.md
  // D1). The subscriptions are read here rather than inside `dispatchSlot`
  // because a user's list is the same for every slot in the round, and reading
  // it per dispatching slot is what made the round's cost grow with the number
  // of slots that happened to come due together.
  const [active, occurrences, logs, subscriptions] = await Promise.all([
    deps.careItemRepo.listActiveSchedulesForUserOn(userId, todayLocalDate),
    deps.careOccurrenceRepo.listByUserAndDate(userId, todayLocalDate),
    deps.careLogRepo.listByUserAndDate(userId, todayLocalDate),
    deps.subscriptionRepo.listByUser(userId),
  ]);

  const occurrenceBySlot = indexBySlot(occurrences);
  const answeredSlots = new Set(logs.map((log) => slotKey(log.careScheduleId, log.timeOfDay)));

  // Earliest scheduled time first (D4): when the budget covers only some of the
  // round, the slots closest to falling out of `FIRST_FIRE_GRACE_MINUTES` — and
  // so closest to dying for the day — are the ones that get served. The
  // repository's own ordering is not relied on.
  const ordered = [...active].sort((a, b) => a.schedule.timeOfDay.localeCompare(b.schedule.timeOfDay));

  for (const [index, { item, schedule }] of ordered.entries()) {
    // Checked BEFORE the claim, never after: a claim taken by a round that then
    // runs out of subrequests is exactly the silent drop this change exists to
    // remove. Deferred slots are left untouched and are still due, so the next
    // wake dispatches them normally.
    //
    // Deliberately NOT scaled by `subscriptions.length` (design.md D4,
    // superseding the uncapped-reserve decision this comment used to
    // document): a per-subscription reserve here made a large fleet
    // (`subscriptions.length` past roughly 21, on a 50-request step) defer
    // every slot on every wake, forever — a permanent silent drop reached from
    // the conservative direction. This gate charges only the cost that is
    // unconditional for ANY due slot, however many subscriptions it has: the
    // fixed writes, one send's worst case, and the tail/failure reserves.
    // `sendClaimedSlot`'s own per-subscription loop is what keeps the REST of
    // a large fleet's dispatch inside budget — see `PER_SUBSCRIPTION_WORST_CASE`
    // and `SLOT_TAIL_RESERVE` there.
    if (!hasHeadroomFor(deps, SLOT_DISPATCH_WRITES + PER_SUBSCRIPTION_WORST_CASE + FAILURE_RECORD_RESERVE)) {
      console.warn(`care-dispatch: deferred ${ordered.length - index} slots, subrequest budget exhausted`);
      break;
    }

    const key = slotKey(schedule.id, schedule.timeOfDay);
    try {
      await dispatchSlot(
        now,
        todayLocalDate,
        nowMinute,
        item,
        schedule,
        { occurrence: occurrenceBySlot.get(key) ?? null, answered: answeredSlots.has(key), subscriptions },
        deps,
      );
    } catch (err) {
      // Isolate: one schedule's failure must not abort the round — but no
      // longer silently. A round in which a slot failed has to be
      // distinguishable in the logs from one in which every slot succeeded.
      console.error("care-dispatch: slot dispatch failed", { careScheduleId: schedule.id, error: failureDetail(err) });
    }
  }

  await retireOrphanedOccurrences(occurrences, ordered, answeredSlots, deps);
}

/**
 * Writes off occurrences from today's batch whose slot is no longer one of the
 * schedule's active slots for the day — the residue of a same-day time change,
 * which no read keyed on the schedule's current time will ever see again (D7).
 *
 * Only never-delivered orphans: one the user already received may still be
 * answered, and the ordinary end-of-day `markMissedForUserDay` covers it.
 * `upsertIfAbsent` is insert-if-absent, so a `done`/`skipped` already recorded
 * is never clobbered. Orphans are never dispatched — the user moved that
 * reminder deliberately.
 *
 * Restricted to schedules that still have an active slot today, because that is
 * where this round's batch already knows the schedule's `doseQuantity`; an
 * occurrence whose schedule is disabled or deleted has no active slot at all and
 * is left to the same end-of-day path that has always handled it, rather than
 * buying a per-orphan read.
 */
async function retireOrphanedOccurrences(
  occurrences: CareOccurrence[],
  active: { item: CareItem; schedule: CareSchedule }[],
  answeredSlots: Set<string>,
  deps: RunCareDayDeps,
): Promise<void> {
  const activeSlots = new Set(active.map(({ schedule }) => slotKey(schedule.id, schedule.timeOfDay)));
  const scheduleById = new Map(active.map(({ item, schedule }) => [schedule.id, { item, schedule }]));

  const orphans = occurrences.filter(
    (occurrence) =>
      occurrence.lastNotifiedAt === null &&
      !activeSlots.has(slotKey(occurrence.careScheduleId, occurrence.timeOfDay)) &&
      !answeredSlots.has(slotKey(occurrence.careScheduleId, occurrence.timeOfDay)) &&
      scheduleById.has(occurrence.careScheduleId),
  );

  for (const [index, occurrence] of orphans.entries()) {
    if (!hasHeadroomFor(deps, ORPHAN_RETIREMENT_WRITES)) {
      console.warn(`care-dispatch: deferred ${orphans.length - index} orphan retirements, subrequest budget exhausted`);
      return;
    }
    const owner = scheduleById.get(occurrence.careScheduleId);
    if (!owner) continue;
    try {
      await deps.careLogRepo.upsertIfAbsent({
        userId: owner.item.userId,
        careItemId: owner.item.id,
        careScheduleId: occurrence.careScheduleId,
        localDate: occurrence.localDate,
        timeOfDay: occurrence.timeOfDay,
        status: "missed",
        doneTime: null,
        doseQuantity: owner.schedule.doseQuantity,
      });
    } catch (err) {
      console.error("care-dispatch: orphan retirement failed", { careScheduleId: occurrence.careScheduleId, error: failureDetail(err) });
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
  // Three reads, whatever the schedule count (design.md D1) — the per-schedule
  // `getBySlot` pair this replaces made planning a wake cost `1 + 2N`.
  const [active, occurrences, logs] = await Promise.all([
    deps.careItemRepo.listActiveSchedulesForUserOn(userId, todayLocalDate),
    deps.careOccurrenceRepo.listByUserAndDate(userId, todayLocalDate),
    deps.careLogRepo.listByUserAndDate(userId, todayLocalDate),
  ]);

  const occurrenceBySlot = indexBySlot(occurrences);
  const answeredSlots = new Set(logs.map((log) => slotKey(log.careScheduleId, log.timeOfDay)));

  const slots: SlotSnapshot[] = active.map(({ schedule }) => {
    const key = slotKey(schedule.id, schedule.timeOfDay);
    return { schedule, occurrence: occurrenceBySlot.get(key) ?? null, answered: answeredSlots.has(key) };
  });

  return { todayLocalDate, slots };
}
