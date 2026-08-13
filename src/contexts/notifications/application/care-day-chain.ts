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
 * The next care day **on or after** `localDate` — `null` if there is none.
 *
 * The definition of "the next care day counting today itself" shared by the
 * two application-level callers: the instance chain's hand-off and the
 * restart gate below. `nextCareChainDate` scans STRICTLY after its argument,
 * so the shift is what lets `localDate` be selected as its own answer.
 *
 * The daily cron does NOT go through here — it only ever holds a flat
 * schedule array, not a repo, so it repeats the same shift independently at
 * `ensure-care-day-instances.ts:48` (`nextCareChainDate(schedules,
 * previousLocalDate(todayLocalDate))`). That is a second place this
 * off-by-one has to be tested and mutated; a test here kills neither.
 *
 * The shift belongs here rather than in the domain function: "strictly after
 * this anchor" is what makes `nextCareChainDate` composable, and the on-or-
 * after variant is a use-case-level convenience built on top of it.
 */
export async function planCareChainDateOnOrAfter(repo: CareChainItemRepo, userId: string, localDate: string): Promise<string | null> {
  return planNextCareChainDate(repo, userId, previousLocalDate(localDate));
}

/**
 * Whether `userId` has any care day left to run, **counting `todayLocalDate`
 * itself**. The gate for the restart path: no upcoming care day means there is
 * nothing for a fresh instance to do.
 */
export async function hasUpcomingCareDate(repo: CareChainItemRepo, userId: string, todayLocalDate: string): Promise<boolean> {
  return (await planCareChainDateOnOrAfter(repo, userId, todayLocalDate)) !== null;
}
