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
