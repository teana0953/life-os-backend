import { localParts } from "../../../shared-kernel/reminder-clock";
import type { CareDayInstanceManager } from "../domain/care-day-instance";
import type { CareItemRepository } from "../domain/care-item";

export interface EnsureCareDayInstancesDeps {
  careItemRepo: CareItemRepository;
  instanceManager: CareDayInstanceManager;
}

/**
 * The daily cron's body, downgraded from "dispatch" to "repair" (D7 revised
 * in replace-cron-with-workflows/design.md): for every distinct (userId,
 * timezone) with at least one enabled schedule, ensure a Workflow instance
 * exists for that user's *today*. `ensureToday` is a no-op when one already
 * exists (deterministic instance id) — this is the chain's self-healing
 * path (W1: a broken chain self-heals within 24h), not its primary driver.
 */
export async function ensureCareDayInstances(now: Date, deps: EnsureCareDayInstancesDeps): Promise<void> {
  const active = await deps.careItemRepo.listActiveSchedules();
  const seen = new Set<string>();

  for (const { item, timezone } of active) {
    const key = `${item.userId}|${timezone}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const todayLocalDate = localParts(now, timezone).date;
      await deps.instanceManager.ensureToday(item.userId, todayLocalDate);
    } catch {
      // Isolate: one user's instance-creation failure must not block the rest.
    }
  }
}
