import { epochDayOf, nextLocalDate, weekdayOf, weeksSince } from "../../../shared-kernel/reminder-clock";
import type { CareSchedule } from "./care-item";

/**
 * Whether `schedule` is active on `localDate`: weekday selected (or
 * `repeatDays` empty = every day, D3 in add-medication-reminders/design.md),
 * within `[startDate, endDate]`, and the every-N-weeks interval (anchored to
 * `startDate`) is on. Shared by `run-care-day` (`dispatchDueRounds`) and
 * `getCareToday` (D4 in add-care-today-endpoint/design.md) so they can never
 * drift.
 */
export function isActiveOn(schedule: CareSchedule, localDate: string): boolean {
  if (schedule.repeatDays.length > 0 && !schedule.repeatDays.includes(weekdayOf(localDate))) return false;
  if (localDate < schedule.startDate) return false;
  if (schedule.endDate !== null && localDate > schedule.endDate) return false;
  const weeks = weeksSince(schedule.startDate, localDate);
  return weeks >= 0 && weeks % schedule.weekInterval === 0;
}

/**
 * How many days ahead `nextCareChainDate` scans before giving up and returning
 * a *checkpoint* day instead of a real firing day. It doubles as the modulus of
 * the global checkpoint grid, and the two must stay equal: that is what makes
 * "every window of this length contains exactly one grid day" true, hence why
 * the scan can never fail to find a checkpoint.
 *
 * **90 is deliberately far below every known platform boundary, not an
 * optimum derived from one.** A single `step.sleep` may span up to a year, so
 * a much larger horizon would also "fit" on paper — but this reminder chain
 * has now failed in production three times, each time because the real
 * Cloudflare API refused something the docs and the types said was fine (an
 * instance id containing `:`, a `sleepUntil` for a past instant, reusing a
 * terminated id). Correctness here must not depend on being inside a limit by
 * a margin anyone has to compute. 90 days means a dormant user's chain wakes
 * ~4 times a year for ~5 steps each — a cost small enough to be irrelevant —
 * while no sleep this code emits ever approaches a documented ceiling.
 */
export const CARE_CHAIN_HORIZON_DAYS = 90;

/**
 * The next local date on or after `afterLocalDate + 1` on which at least one
 * of `schedules` is enabled and active (`isActiveOn`) — the single successor
 * function shared by the instance chain (`runCareReminderDay`'s exit), the
 * restart gate, and the daily cron, so those three can never disagree about
 * which day a `CareReminderWorkflow` instance should exist for.
 *
 * `afterLocalDate` itself is **never** returned: the scan starts strictly at
 * the following day. Callers that want "today counts too" pass
 * `previousLocalDate(today)` (see `hasUpcomingCareDate`).
 *
 * Returns `null` when nothing can fire again — the chain's terminate signal.
 * When the scan reaches `CARE_CHAIN_HORIZON_DAYS` without a hit but some
 * enabled schedule could still fire beyond it (no end date, or one past the
 * horizon), a **checkpoint** day inside the scanned window is returned: an
 * instance that wakes there finds no slots, re-runs this scan from its own
 * day, and either jumps another horizon forward or terminates. That is what
 * keeps a long-interval schedule (e.g. every 60 weeks) alive without an
 * unbounded scan.
 *
 * **The checkpoint is a function of the calendar, never of `afterLocalDate`.**
 * It is the first day in the scanned window that sits on a fixed global grid
 * (`epochDayOf(day) % CARE_CHAIN_HORIZON_DAYS === 0`) — any `CARE_CHAIN_HORIZON_DAYS`
 * consecutive days contain exactly one such day, so the scan always finds one.
 * Anchor-relative checkpoints (`afterLocalDate + horizon`) would break the one
 * invariant this whole function exists to provide: the cron re-anchors on a
 * different day every day (`previousLocalDate(today)`), so a dormant user would
 * get a brand-new, never-colliding instance id every single day — ~90 idle
 * sleepers accumulating per user against the free plan's 100 concurrent
 * instances, i.e. the runaway idle chain this function was written to kill,
 * amplified. With a grid, every anchor inside the same grid cell yields the
 * same day, so cron and chain converge on one deterministic id (see W1' in
 * replace-cron-with-workflows/design.md).
 *
 * The `enabled` filter lives here rather than in `isActiveOn` (whose two
 * pre-existing callers already filter separately) or in SQL, so that "which
 * day comes next" has exactly one testable definition.
 */
export function nextCareChainDate(schedules: CareSchedule[], afterLocalDate: string): string | null {
  let date = afterLocalDate;
  let checkpoint: string | null = null;
  for (let i = 0; i < CARE_CHAIN_HORIZON_DAYS; i++) {
    date = nextLocalDate(date);
    if (schedules.some((schedule) => schedule.enabled && isActiveOn(schedule, date))) return date;
    if (checkpoint === null && epochDayOf(date) % CARE_CHAIN_HORIZON_DAYS === 0) checkpoint = date;
  }
  // Nothing fires inside the window. `date` is its last day: keep the chain
  // alive (via the grid checkpoint, which lies inside the window and so
  // re-scans a superset of what is left) only if something could still fire
  // after the window.
  const mayFireBeyondHorizon = schedules.some((schedule) => schedule.enabled && (schedule.endDate === null || schedule.endDate > date));
  return mayFireBeyondHorizon ? checkpoint : null;
}
