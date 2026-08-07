import type {
  CreateNetWorthAccountInput,
  NetWorthAccount,
  NetWorthKind,
  UpdateNetWorthAccountPatch,
} from "../../../src/contexts/finance/domain/networth-account";
import type {
  MonthlyNetWorthTotals,
  NetWorthRepository,
} from "../../../src/contexts/finance/domain/networth-repository";
import type {
  NetWorthAccountValue,
  NetWorthSnapshot,
  NetWorthTrendPoint,
  UpsertNetWorthSnapshotInput,
} from "../../../src/contexts/finance/domain/networth-snapshot";

/**
 * In-memory fake for unit tests. Snapshot aggregation (monthly totals, previous
 * month, trend) mirrors the real adapter's SQL: liabilities/assets both stored
 * positive, archived accounts' historical snapshots still counted (archived only
 * blocks new writes), previous month = most recent earlier month with any snapshot.
 */
export class InMemoryNetWorthRepository implements NetWorthRepository {
  accounts: NetWorthAccount[] = [];
  snapshots: NetWorthSnapshot[] = [];
  private nextAccountId = 1;
  private nextSnapshotId = 1;

  async listAccounts(userId: string): Promise<NetWorthAccount[]> {
    const kindOrder: Record<NetWorthKind, number> = { asset: 0, liability: 1 };
    return this.accounts
      .filter((a) => a.userId === userId)
      .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.sortOrder - b.sortOrder);
  }

  async findAccountById(id: string): Promise<NetWorthAccount | null> {
    return this.accounts.find((a) => a.id === id) ?? null;
  }

  async findAccountByUserKindName(userId: string, kind: NetWorthKind, name: string): Promise<NetWorthAccount | null> {
    return this.accounts.find((a) => a.userId === userId && a.kind === kind && a.name === name) ?? null;
  }

  async createAccount(input: CreateNetWorthAccountInput): Promise<NetWorthAccount> {
    const account: NetWorthAccount = {
      id: `account-${this.nextAccountId++}`,
      userId: input.userId,
      kind: input.kind,
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      archived: false,
    };
    this.accounts.push(account);
    return account;
  }

  async updateAccount(userId: string, id: string, patch: UpdateNetWorthAccountPatch): Promise<NetWorthAccount | null> {
    const account = this.accounts.find((a) => a.id === id && a.userId === userId);
    if (!account) return null;
    if (patch.name !== undefined) account.name = patch.name;
    if (patch.sortOrder !== undefined) account.sortOrder = patch.sortOrder;
    if (patch.archived !== undefined) account.archived = patch.archived;
    return account;
  }

  async reorderAccounts(userId: string, kind: NetWorthKind, orderedIds: string[]): Promise<void> {
    orderedIds.forEach((id, index) => {
      const account = this.accounts.find((a) => a.id === id && a.userId === userId && a.kind === kind);
      if (account) account.sortOrder = index;
    });
  }

  async insertDefaultAccountsIfMissing(defaults: CreateNetWorthAccountInput[]): Promise<void> {
    for (const d of defaults) {
      const exists = this.accounts.some((a) => a.userId === d.userId && a.kind === d.kind && a.name === d.name);
      if (!exists) await this.createAccount(d);
    }
  }

  async upsertSnapshot(input: UpsertNetWorthSnapshotInput): Promise<NetWorthSnapshot> {
    const existing = this.snapshots.find((s) => s.accountId === input.accountId && s.month === input.month);
    if (existing) {
      existing.value = input.value;
      return existing;
    }
    const snapshot: NetWorthSnapshot = {
      id: `snapshot-${this.nextSnapshotId++}`,
      userId: input.userId,
      accountId: input.accountId,
      month: input.month,
      value: input.value,
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async listMonthValues(userId: string, month: string): Promise<NetWorthAccountValue[]> {
    return this.snapshots
      .filter((s) => s.userId === userId && s.month === month)
      .map((s) => {
        const account = this.accounts.find((a) => a.id === s.accountId);
        return {
          accountId: s.accountId,
          kind: account?.kind ?? "asset",
          name: account?.name ?? "",
          value: s.value,
        };
      });
  }

  async getMonthlyTotals(userId: string, month: string): Promise<MonthlyNetWorthTotals> {
    let totalAsset = 0;
    let totalLiability = 0;
    for (const s of this.snapshots.filter((x) => x.userId === userId && x.month === month)) {
      const account = this.accounts.find((a) => a.id === s.accountId);
      if (account?.kind === "liability") totalLiability += s.value;
      else totalAsset += s.value;
    }
    return { totalAsset, totalLiability };
  }

  async findPreviousSnapshotMonth(userId: string, month: string): Promise<string | null> {
    const earlier = this.snapshots
      .filter((s) => s.userId === userId && s.month < month)
      .map((s) => s.month)
      .sort();
    return earlier.length > 0 ? earlier[earlier.length - 1] : null;
  }

  async getTrend(userId: string, from: string, to: string): Promise<NetWorthTrendPoint[]> {
    const byMonth = new Map<string, number>();
    for (const s of this.snapshots.filter((x) => x.userId === userId && x.month >= from && x.month <= to)) {
      const account = this.accounts.find((a) => a.id === s.accountId);
      const delta = account?.kind === "liability" ? -s.value : s.value;
      byMonth.set(s.month, (byMonth.get(s.month) ?? 0) + delta);
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, netWorth]) => ({ month: m, netWorth }));
  }
}
