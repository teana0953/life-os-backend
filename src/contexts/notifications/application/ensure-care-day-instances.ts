import { localParts, previousLocalDate } from "../../../shared-kernel/reminder-clock";
import type { CareDayInstanceManager } from "../domain/care-day-instance";
import type { CareItemRepository, CareSchedule } from "../domain/care-item";
import { nextCareChainDate } from "../domain/care-schedule";

export interface EnsureCareDayInstancesDeps {
  careItemRepo: CareItemRepository;
  instanceManager: CareDayInstanceManager;
}

/**
 * The daily cron's body, downgraded from "dispatch" to "repair" (D7' revised
 * in replace-cron-with-workflows/design.md): for every user with at least one
 * enabled schedule, ensure a Workflow instance exists for **the next day that
 * user actually has something scheduled** — today when today is one, a future
 * date otherwise, and none at all when nothing can ever fire again.
 *
 * It uses the very same `nextCareChainDate` the running chain uses to pick its
 * own successor, so cron and chain cannot disagree about which day should own
 * an instance. `ensureFor` is a no-op when that instance already exists
 * (deterministic instance id), which is the ordinary case; this is the
 * self-healing path (W1: a broken chain is repaired within 24h), not the
 * primary driver.
 *
 * A repaired instance created for a future day simply sleeps until that day
 * starts (`runCareReminderDay`'s day-start wait), so unlike the previous
 * "always today" behaviour, repair no longer misses the slots of a day that
 * began before the cron ran.
 */
export async function ensureCareDayInstances(now: Date, deps: EnsureCareDayInstancesDeps): Promise<void> {
  const active = await deps.careItemRepo.listActiveSchedules();

  // `listActiveSchedules` returns one row per enabled schedule; the successor
  // function needs ALL of a user's schedules together (the earliest active day
  // across them wins), so group first rather than deciding row by row.
  const byUser = new Map<string, { timezone: string; schedules: CareSchedule[] }>();
  for (const { item, schedule, timezone } of active) {
    const entry = byUser.get(item.userId);
    if (entry) entry.schedules.push(schedule);
    else byUser.set(item.userId, { timezone, schedules: [schedule] });
  }

  for (const [userId, { timezone, schedules }] of byUser) {
    try {
      const todayLocalDate = localParts(now, timezone).date;
      // `previousLocalDate` because the scan starts strictly after its
      // argument — today itself must be eligible.
      const target = nextCareChainDate(schedules, previousLocalDate(todayLocalDate));
      if (target === null) continue; // nothing will ever fire again — do not create an instance to discover that.
      await deps.instanceManager.ensureFor(userId, target);
    } catch {
      // Isolate: one user's instance-creation failure must not block the rest.
    }
  }
}
