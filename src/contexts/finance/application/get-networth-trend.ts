import type { NetWorthRepository } from "../domain/networth-repository";
import type { NetWorthTrendPoint } from "../domain/networth-snapshot";

/**
 * Use case: per-month net worth (asset sum − liability sum) for months in
 * [from, to] that have any snapshot, ascending. A month with no snapshot is
 * absent; a range with no snapshots is an empty series. The aggregation and
 * ordering happen in the repository (SQL group by month).
 */
export async function getNetWorthTrend(
  repository: NetWorthRepository,
  userId: string,
  from: string,
  to: string,
): Promise<NetWorthTrendPoint[]> {
  return repository.getTrend(userId, from, to);
}
