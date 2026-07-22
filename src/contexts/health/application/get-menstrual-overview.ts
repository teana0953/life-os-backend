import type { MenstrualPeriod } from "../domain/menstrual-period";
import type { MenstrualRepository } from "../domain/menstrual-repository";
import { computeMenstrualStats, type MenstrualStats } from "../domain/menstrual-stats";

export interface MenstrualOverview {
  /** The user's periods, ascending by startDate. */
  periods: MenstrualPeriod[];
  stats: MenstrualStats;
  /** The most recent period (max startDate), or null when there are none. */
  lastPeriod: MenstrualPeriod | null;
}

/**
 * Use case: the user's periods (sorted ascending), the derived cycle statistics
 * (computed on read), and the most recent period. An empty user reports empty
 * periods, all-null stats, and a null last period.
 */
export async function getMenstrualOverview(
  repository: MenstrualRepository,
  userId: string,
): Promise<MenstrualOverview> {
  const periods = await repository.listByUser(userId);
  return {
    periods,
    stats: computeMenstrualStats(periods),
    lastPeriod: periods.length === 0 ? null : periods[periods.length - 1],
  };
}
