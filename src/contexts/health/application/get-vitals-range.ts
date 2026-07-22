import type { VitalsRepository } from "../domain/vitals-repository";
import { buildVitalsSeries, type VitalsSeries } from "../domain/vitals-series";

export interface VitalsRangeOverview {
  from: string;
  to: string;
  series: VitalsSeries;
}

/**
 * Use case: the user's vitals over `[from, to]` as per-metric daily time series.
 * Reads the range and derives each metric's series via `buildVitalsSeries`.
 */
export async function getVitalsRange(
  repository: VitalsRepository,
  userId: string,
  from: string,
  to: string,
): Promise<VitalsRangeOverview> {
  const records = await repository.listRange(userId, from, to);
  return { from, to, series: buildVitalsSeries(records) };
}
