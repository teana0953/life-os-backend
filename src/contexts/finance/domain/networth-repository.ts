import type { CreateNetWorthAccountInput, NetWorthAccount, NetWorthKind, UpdateNetWorthAccountPatch } from "./networth-account";
import type { NetWorthAccountValue, NetWorthSnapshot, NetWorthTrendPoint, UpsertNetWorthSnapshotInput } from "./networth-snapshot";

/** Per-kind asset/liability snapshot sums for a single month (DB-aggregated; both stored positive). */
export interface MonthlyNetWorthTotals {
  totalAsset: number;
  totalLiability: number;
}

export interface NetWorthRepository {
  /** All of the user's accounts (including archived), in `sort_order` order (asset before liability by kind then sort). */
  listAccounts(userId: string): Promise<NetWorthAccount[]>;
  findAccountById(id: string): Promise<NetWorthAccount | null>;
  findAccountByUserKindName(userId: string, kind: NetWorthKind, name: string): Promise<NetWorthAccount | null>;
  createAccount(input: CreateNetWorthAccountInput): Promise<NetWorthAccount>;
  /** Owner-scoped partial update (name/sort_order/archived; kind immutable); returns null when not owned/found. */
  updateAccount(userId: string, id: string, patch: UpdateNetWorthAccountPatch): Promise<NetWorthAccount | null>;
  /**
   * Idempotently inserts the given defaults for `userId`, ignoring any that
   * already exist (the `(user_id, kind, name)` unique index is the concurrency
   * guard behind `ensureDefaultAccounts`' "seed only if the user has none").
   */
  insertDefaultAccountsIfMissing(defaults: CreateNetWorthAccountInput[]): Promise<void>;

  /** Upsert one (account, month) snapshot value — overwrites an existing value for that account-month. */
  upsertSnapshot(input: UpsertNetWorthSnapshotInput): Promise<NetWorthSnapshot>;

  /** That month's per-account snapshot values for the user (only accounts that have a snapshot that month). */
  listMonthValues(userId: string, month: string): Promise<NetWorthAccountValue[]>;
  /** DB-aggregated asset/liability snapshot sums for the user in `month` (includes archived accounts' historical snapshots). */
  getMonthlyTotals(userId: string, month: string): Promise<MonthlyNetWorthTotals>;
  /** The most recent month strictly before `month` that has any snapshot for the user, or null when none. */
  findPreviousSnapshotMonth(userId: string, month: string): Promise<string | null>;
  /** Per-month net worth (asset sum − liability sum) for months in [from, to] that have snapshots, ascending. */
  getTrend(userId: string, from: string, to: string): Promise<NetWorthTrendPoint[]>;
}
