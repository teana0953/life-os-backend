import type { NetWorthKind } from "./networth-account";

export interface NetWorthSnapshot {
  id: string;
  userId: string;
  accountId: string;
  month: string;
  value: number;
}

export interface UpsertNetWorthSnapshotInput {
  userId: string;
  accountId: string;
  month: string;
  value: number;
}

/** A single account's snapshot value for the queried month (design.md: response lists only accounts that have a snapshot that month). */
export interface NetWorthAccountValue {
  accountId: string;
  kind: NetWorthKind;
  name: string;
  value: number;
}

/** One month's point on the net-worth trend series (asset sum − liability sum). */
export interface NetWorthTrendPoint {
  month: string;
  netWorth: number;
}
