/**
 * Port onto the Workflows binding that drives one user's reminders for one
 * local day (W1 in replace-cron-with-workflows/design.md): each method is
 * "make it true that today's instance for this user exists / is fresh",
 * never a raw Workflows RPC — the binding itself only appears in the
 * adapter, so `domain`/`application` never import `cloudflare:workers`.
 */
export interface CareDayInstanceManager {
  /**
   * Ensures a Workflow instance exists for `userId`'s `localDate` (the daily
   * cron's bootstrap/repair path, W1). A no-op when one already exists
   * (deterministic instance id, so `create` colliding with an existing id is
   * the expected, silently-ignored outcome — not an error).
   */
  ensureToday(userId: string, localDate: string): Promise<void>;

  /**
   * Best-effort immediate-effect hook: terminates today's instance (if any)
   * and creates a fresh one, so a schedule/timezone/subscription change
   * takes effect within seconds instead of waiting for the instance's own
   * next wake. Callers treat failures here as non-fatal — the daily cron
   * and the instance's own chained spawn are the durable paths; this is
   * purely a latency improvement (key_decisions "即時生效機制").
   */
  restartToday(userId: string, localDate: string): Promise<void>;
}

/**
 * Port onto the `care_day_instance_pointer` table: the one durable record of
 * which instance id `restartToday` most recently created for a user's
 * `local_date` (fix/restart-instance-tracking). The Workflows binding itself
 * has no way to enumerate a user's live instances (`Workflow<PARAMS>` only
 * has `create`/`get`/`createBatch`), so without this pointer a second
 * `restartToday` call can never find and terminate the instance the first
 * one created — this table is what makes that possible.
 *
 * Only `WorkflowsCareDayInstanceManager.restartToday` reads or writes this —
 * `ensureToday` and the instance's own midnight self-spawn both use the
 * deterministic id and are found by construction, so they never touch this
 * table (no added per-day DB write on those paths).
 */
export interface CareDayInstancePointerStore {
  /**
   * The instance id recorded for `userId`'s `localDate`, or `null` if there
   * is none — either no row exists yet, or the stored row is for a different
   * (stale, e.g. yesterday's) `localDate`, which must be treated the same as
   * "no pointer for today".
   */
  getCurrent(userId: string, localDate: string): Promise<string | null>;

  /**
   * Compare-and-swap: advances the pointer to `newInstanceId` for `localDate`
   * iff the stored state still equals `expected` — exactly what a prior
   * `getCurrent(userId, localDate)` returned. Returns `true` iff this caller
   * won the swap (it is now the recorded current instance for the day);
   * `false` means a concurrent `restartToday` already advanced the pointer
   * first, out from under `expected`, or the swap itself could not be
   * verified. This is the concurrency guard for two simultaneous
   * `restartToday` calls: `newInstanceId` is always created BEFORE this call
   * is made (never after), so the swap's loser must terminate the instance
   * it already created for itself — it does not get to keep it "current"
   * just because it exists.
   */
  setCurrentIfMatch(userId: string, localDate: string, expected: string | null, newInstanceId: string): Promise<boolean>;
}
