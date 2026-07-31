import type { NetWorthRepository } from "../domain/networth-repository";
import type { NetWorthAccountValue } from "../domain/networth-snapshot";

export interface MonthlyNetWorth {
  month: string;
  accounts: NetWorthAccountValue[];
  totalAsset: number;
  totalLiability: number;
  netWorth: number;
  /** The prior month's net worth, or null when no earlier month has any snapshot. */
  prevNetWorth: number | null;
  /** (net − prev) / prev, or null when there's no prior month or prev ≤ 0 (undefined/sign-misleading base). */
  growthRate: number | null;
}

/**
 * Use case: the month's net worth and growth rate. `net_worth` = asset sum −
 * liability sum (both stored positive; the DB does the aggregation). "Prior
 * month" is the most recent earlier month that has any snapshot — not the
 * calendar previous month — whose net worth is recomputed live. `growth_rate`
 * is null when there's no prior month, or when the prior net worth is ≤ 0
 * (division by zero, or a sign-misleading ratio against a negative base).
 */
export async function getMonthlyNetWorth(repository: NetWorthRepository, userId: string, month: string): Promise<MonthlyNetWorth> {
  const accounts = await repository.listMonthValues(userId, month);
  const { totalAsset, totalLiability } = await repository.getMonthlyTotals(userId, month);
  const netWorth = totalAsset - totalLiability;

  const prevMonth = await repository.findPreviousSnapshotMonth(userId, month);
  let prevNetWorth: number | null = null;
  if (prevMonth !== null) {
    const prev = await repository.getMonthlyTotals(userId, prevMonth);
    prevNetWorth = prev.totalAsset - prev.totalLiability;
  }

  const growthRate = prevNetWorth !== null && prevNetWorth > 0 ? (netWorth - prevNetWorth) / prevNetWorth : null;

  return { month, accounts, totalAsset, totalLiability, netWorth, prevNetWorth, growthRate };
}
