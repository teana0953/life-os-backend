import type { ChaodaysClient } from "../domain/chaodays-client";
import type { DailyTargetRepository, SetDailyTargetInput } from "../domain/daily-target-repository";
import type { SetWaterTargetInput, WaterRepository } from "../domain/water-repository";
import { fetchInBatches } from "./fetch-in-batches";

export interface ImportChaodaysDietTargetInput {
  userId: string;
  uid: string;
  password: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  from: string;
  to: string;
}

export interface ImportChaodaysDietTargetSummary {
  portionTargetsImported: number;
  portionTargetsSkipped: number;
  waterTargetsImported: number;
  waterTargetsSkipped: number;
  from: string;
  to: string;
}

/**
 * Use case: sign in to chaodays, pull diet menus (daily portion + water
 * targets) for `[from, to]`, and import each day's targets into the
 * corresponding lifeos target — the daily target's `base*` portions, and the
 * water target. A day that already has the corresponding lifeos target is
 * skipped (counted, not clobbered) — the daily target's exercise bonus is
 * preserved, and idempotent re-import doesn't overwrite prior imports or
 * manual edits. A menu whose portions are all zero writes NO daily target (it
 * would otherwise clobber the day's carry-forward standing target and block a
 * later real import); a menu with no water target (0) is not written either.
 *
 * To keep the number of DB round-trips independent of the date range, existing
 * daily targets and water targets for the whole range are each read once,
 * everything is computed in memory, and all writes are persisted via one
 * batched `setMany` call plus one batched `setTargetMany` call.
 */
export async function importChaodaysDietTarget(
  dailyTargetRepository: DailyTargetRepository,
  waterRepository: WaterRepository,
  chaodaysClient: ChaodaysClient,
  input: ImportChaodaysDietTargetInput,
): Promise<ImportChaodaysDietTargetSummary> {
  const session = await chaodaysClient.signIn(input.uid, input.password);
  const menus = await fetchInBatches(session, input.from, input.to, async (batchSession, from, to) => {
    const batch = await chaodaysClient.fetchDietMenus(batchSession, from, to);
    return { session: batch.session, records: batch.menus };
  });

  // Reads for the whole range happen once, before any writes.
  const existingTargets = await dailyTargetRepository.listInRange(input.userId, input.from, input.to);
  const existingTargetDays = new Set(existingTargets.map((t) => t.day));
  const existingWaterTargets = await waterRepository.listTargetRange(input.userId, input.from, input.to);
  const existingWaterTargetDays = new Set(existingWaterTargets.map((t) => t.day));

  let portionTargetsImported = 0;
  let portionTargetsSkipped = 0;
  let waterTargetsImported = 0;
  let waterTargetsSkipped = 0;
  const targetRows: SetDailyTargetInput[] = [];
  const waterTargetRows: SetWaterTargetInput[] = [];

  for (const menu of menus) {
    const hasPortions = menu.staple > 0 || menu.meat > 0 || menu.fruit > 0 || menu.veg > 0;
    if (hasPortions && !existingTargetDays.has(menu.date)) {
      targetRows.push({
        userId: input.userId,
        day: menu.date,
        baseStaple: menu.staple,
        baseMeat: menu.meat,
        baseFruit: menu.fruit,
        baseVeg: menu.veg,
      });
      portionTargetsImported++;
    } else {
      portionTargetsSkipped++;
    }

    if (menu.waterTargetMl > 0 && !existingWaterTargetDays.has(menu.date)) {
      waterTargetRows.push({ userId: input.userId, day: menu.date, targetMl: menu.waterTargetMl });
      waterTargetsImported++;
    } else {
      waterTargetsSkipped++;
    }
  }

  if (targetRows.length > 0) await dailyTargetRepository.setMany(targetRows);
  if (waterTargetRows.length > 0) await waterRepository.setTargetMany(waterTargetRows);

  return {
    portionTargetsImported,
    portionTargetsSkipped,
    waterTargetsImported,
    waterTargetsSkipped,
    from: input.from,
    to: input.to,
  };
}
