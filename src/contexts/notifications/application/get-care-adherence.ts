import { buildCareAdherenceSeries, type CareAdherenceSeries } from "../domain/care-adherence";
import type { CareItemRepository } from "../domain/care-item";
import type { CareLogRepository } from "../domain/care-log";

export interface GetCareAdherenceDeps {
  careItemRepo: CareItemRepository;
  careLogRepo: CareLogRepository;
}

/**
 * Use case: the user's care adherence over `[from, to]` as a daily series —
 * mirrors `getVitalsRange`. Reads all of the user's schedules via
 * `listByUser` (flattened across items — no dedicated schedule-listing
 * method needed) and that day range's logs via `listByUserAndDateRange`,
 * then derives the series with the pure `buildCareAdherenceSeries`.
 */
export async function getCareAdherence(deps: GetCareAdherenceDeps, userId: string, from: string, to: string): Promise<CareAdherenceSeries> {
  const items = await deps.careItemRepo.listByUser(userId);
  const schedules = items.flatMap((item) => item.schedules);
  const logs = await deps.careLogRepo.listByUserAndDateRange(userId, from, to);
  return buildCareAdherenceSeries(schedules, logs, from, to);
}
