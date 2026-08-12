/** `expired` = every subscription in that round's send was gone (see `RecordAttemptInput.outcome`). */
export type CareSendOutcome = "sent" | "expired" | "failed" | "no_subscriptions";

export interface CareOccurrence {
  id: string;
  userId: string;
  careItemId: string;
  careScheduleId: string;
  /** `YYYY-MM-DD`, local to the owning user (D5 in design.md). */
  localDate: string;
  /** Local `HH:mm`. */
  timeOfDay: string;
  lastNotifiedAt: Date | null;
  /** When the most recently *recorded* send attempt ran (design D11/D12). */
  lastAttemptAt: Date | null;
  lastSendOutcome: CareSendOutcome | null;
  /** Short non-credential diagnostic, e.g. `"sent=1 failed=2 status_401"` (design D13). */
  lastSendDetail: string | null;
}

export interface RecordAttemptInput {
  at: Date;
  outcome: CareSendOutcome;
  detail: string | null;
  /** Whether this round counts as delivered (D10): only true when `outcome === "sent"`. */
  delivered: boolean;
}

export interface CreateCareOccurrenceInput {
  userId: string;
  careItemId: string;
  careScheduleId: string;
  localDate: string;
  timeOfDay: string;
}

export interface ClaimAttemptInput {
  /** The instant this claim is for; written to `last_attempt_at` on success. */
  at: Date;
  /**
   * The claim succeeds only when the row's current `last_attempt_at` is
   * `NULL` or at-or-before `at - leaseMinutes` — a leased claim, not a
   * compare-and-swap against one exact expected value (gate_decision #1 in
   * replace-cron-with-workflows/design.md, superseding this repo's earlier
   * D6' draft). A plain CAS would make a claim that succeeds but never
   * completes (crash between claim and send) unrecoverable for the rest of
   * the day whenever `nagIntervalMinutes = 0` — no later round would ever
   * see the "expected" value again. The lease means an abandoned claim is
   * retriable once it goes stale.
   *
   * Non-strict (`<=`, not `<`): the caller (`run-care-day.ts`) derives
   * `leaseMinutes` from the exact same interval its own due-check just used,
   * so a round due at exactly `T` must be claimable at exactly `T` — a
   * strict `<` would reject that boundary instant even though the due-check
   * itself (`now >= due`) accepts it.
   */
  leaseMinutes: number;
}

export interface CareOccurrenceRepository {
  /** Insert-if-absent on the slot key `(careScheduleId, localDate, timeOfDay)`, returning the existing row on a conflict (D5 in design.md). */
  upsertBySlot(input: CreateCareOccurrenceInput): Promise<CareOccurrence>;
  getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareOccurrence | null>;
  /**
   * Atomically claims this round's dispatch attempt for `id`: conditionally
   * writes `last_attempt_at = input.at` and returns whether *this* call won
   * the claim (`true`) or lost it to a concurrent/earlier claimant still
   * within its lease (`false`) — see `ClaimAttemptInput`. Callers must claim
   * before sending and only send when the claim is won (gate_decision #1);
   * a lost claim must not push a notification.
   */
  claimAttempt(id: string, input: ClaimAttemptInput): Promise<boolean>;
  /** Records a send attempt's outcome (design D10-D13); updates `lastNotifiedAt` only when `delivered`. */
  recordAttempt(id: string, input: RecordAttemptInput): Promise<void>;
  /**
   * Occurrences of `careScheduleId` whose `localDate` is strictly before
   * `todayLocalDate` AND that have no `care_log` for their slot yet — for
   * markMissed (D7 in design.md). Once a slot is marked missed (or otherwise
   * answered), it has a log and drops out of this result on the next tick, so
   * per-tick work stays bounded to genuinely-unlogged past slots instead of
   * re-scanning all history forever.
   */
  listPastUnlogged(careScheduleId: string, todayLocalDate: string): Promise<CareOccurrence[]>;
  /**
   * "A subscription may have just arrived" nudge (D12' in
   * replace-cron-with-workflows/design.md): rewinds `lastAttemptAt` to the
   * epoch for every `userId` occurrence on `localDate` whose
   * `lastSendOutcome` is `"no_subscriptions"`, so `nextDueAt` treats each as
   * immediately due instead of waiting out `RETRY_INTERVAL_MINUTES`.
   * Restarting the Workflows instance alone does NOT achieve this — the
   * instance's own next wake still recomputes `nextDueAt` from unchanged
   * occurrence rows, so without this call the "near-instant delivery after
   * subscribing" claim silently does not hold. Only `no_subscriptions` rows
   * are touched — a genuine failed/expired round keeps its own retry cadence.
   */
  expediteNoSubscriptionsRetry(userId: string, localDate: string): Promise<void>;
}
