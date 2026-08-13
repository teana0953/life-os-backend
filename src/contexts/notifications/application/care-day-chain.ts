import { previousLocalDate } from "../../../shared-kernel/reminder-clock";
import type { CareItemRepository } from "../domain/care-item";
import { nextCareChainDate } from "../domain/care-schedule";

/** The only repository capability the chain helpers need — `listByUser` gives every schedule, enabled or not. */
export type CareChainItemRepo = Pick<CareItemRepository, "listByUser">;

/**
 * The I/O half of `nextCareChainDate`: flattens `userId`'s schedules and asks
 * the domain function which day the chain should jump to next. `null` = the
 * chain should end here.
 *
 * Reads only the schedule calendar — never occurrences or logs. "Today's slots
 * are all answered" and "today has no slots at all" are deliberately different
 * things: a fully-answered Monday still spawns the next Monday.
 */
export async function planNextCareChainDate(repo: CareChainItemRepo, userId: string, afterLocalDate: string): Promise<string | null> {
  const items = await repo.listByUser(userId);
  return nextCareChainDate(
    items.flatMap((item) => item.schedules),
    afterLocalDate,
  );
}

/**
 * Whether `userId` has any care day left to run, **counting `todayLocalDate`
 * itself** — hence the `previousLocalDate` shift, since `nextCareChainDate`
 * scans strictly after its argument. The gate for the restart path: no
 * upcoming care day means there is nothing for a fresh instance to do.
 */
export async function hasUpcomingCareDate(repo: CareChainItemRepo, userId: string, todayLocalDate: string): Promise<boolean> {
  return (await planNextCareChainDate(repo, userId, previousLocalDate(todayLocalDate))) !== null;
}
