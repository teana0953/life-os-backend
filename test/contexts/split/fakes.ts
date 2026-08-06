import type { Balance, CurrencyBalance } from "../../../src/contexts/split/domain/balance";
import type { BalanceRepository } from "../../../src/contexts/split/domain/balance-repository";
import type { CreateExpenseGroupInput, ExpenseGroup, GroupMember } from "../../../src/contexts/split/domain/expense-group";
import type { ExpenseGroupRepository } from "../../../src/contexts/split/domain/expense-group-repository";
import type { FriendChecker } from "../../../src/contexts/split/domain/friend-checker";
import { groupSettlementDelta, personalSettlementDelta } from "../../../src/contexts/split/domain/settlement-balance";
import type { CreateSettlementInput, Settlement } from "../../../src/contexts/split/domain/settlement";
import type { ListSettlementsFilter, SettlementRepository } from "../../../src/contexts/split/domain/settlement-repository";
import type { ShareMirrorRow, SharesMirror } from "../../../src/contexts/split/domain/shares-mirror";
import type { CreateSplitExpenseInput, SplitExpense, SplitShare, SplitShareInput, UpdateSplitExpenseFields } from "../../../src/contexts/split/domain/split-expense";
import type { InMemoryFinanceTransactionRepository } from "../finance/fakes";
import type { ListExpensesFilter, SplitExpenseRepository } from "../../../src/contexts/split/domain/split-expense-repository";
import type { SplitSpendingAmount } from "../../../src/contexts/split/domain/split-spending";
import type { SplitSpendingRepository } from "../../../src/contexts/split/domain/split-spending-repository";
import type { SplitActivity } from "../../../src/contexts/split/domain/split-activity";
import type { ListActivityOptions, SplitActivityRepository } from "../../../src/contexts/split/domain/split-activity-repository";

/** Test-only directory of display names, standing in for the `users` join a real adapter would do. */
export class TestUserDirectory {
  private names = new Map<string, string>();

  add(userId: string, displayName: string): void {
    this.names.set(userId.toLowerCase(), displayName);
  }

  get(userId: string): string {
    const name = this.names.get(userId.toLowerCase());
    if (!name) throw new Error(`test fake: no user record for ${userId}`);
    return name;
  }
}

export class InMemoryExpenseGroupRepository implements ExpenseGroupRepository {
  groups: ExpenseGroup[] = [];
  members: GroupMember[] = [];
  /**
   * Optional so the many tests that never render a name can keep constructing
   * this bare; supplied, it resolves names the way the production join does.
   */
  constructor(private readonly users?: TestUserDirectory) {}

  private nameFor(userId: string): string {
    return this.users ? this.users.get(userId) : userId;
  }
  /** How many times `membersAmong` was called — pins the "one lookup per group, not per row" rule in `listExpenses`. */
  membersAmongCalls = 0;

  async create(input: CreateExpenseGroupInput): Promise<ExpenseGroup> {
    const now = new Date();
    const group: ExpenseGroup = {
      id: crypto.randomUUID(),
      name: input.name,
      createdByUserId: input.createdByUserId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.groups.push(group);
    this.members.push({ groupId: group.id, userId: input.createdByUserId, displayName: this.nameFor(input.createdByUserId), joinedAt: now });
    return group;
  }

  async findById(id: string): Promise<ExpenseGroup | null> {
    return this.groups.find((g) => g.id === id) ?? null;
  }

  async listForUser(userId: string): Promise<ExpenseGroup[]> {
    const memberGroupIds = new Set(this.members.filter((m) => m.userId === userId).map((m) => m.groupId));
    return this.groups.filter((g) => memberGroupIds.has(g.id));
  }

  /** Mirrors the real `where archived_at is null`: a second archive changes nothing and reports false. */
  async archive(id: string, now: Date, _actorUserId: string): Promise<boolean> {
    const group = this.groups.find((g) => g.id === id);
    if (!group || group.archivedAt !== null) return false;
    group.archivedAt = now;
    return true;
  }

  async addMember(groupId: string, userId: string, now: Date, _actorUserId: string): Promise<GroupMember> {
    const member: GroupMember = { groupId, userId, displayName: this.nameFor(userId), joinedAt: now };
    this.members.push(member);
    return member;
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    return this.members.filter((m) => m.groupId === groupId);
  }

  async listMembersForGroups(groupIds: string[]): Promise<GroupMember[]> {
    const wanted = new Set(groupIds);
    return this.members.filter((m) => wanted.has(m.groupId));
  }

  async shareAnyGroup(userId: string, otherUserId: string): Promise<boolean> {
    const mine = new Set(this.members.filter((m) => m.userId === userId).map((m) => m.groupId));
    return this.members.some((m) => m.userId === otherUserId && mine.has(m.groupId));
  }

  async membersAmong(groupId: string, userIds: string[]): Promise<Set<string>> {
    this.membersAmongCalls += 1;
    const groupMembers = new Set(this.members.filter((m) => m.groupId === groupId).map((m) => m.userId));
    return new Set(userIds.filter((id) => groupMembers.has(id)));
  }
}

export class InMemoryFriendChecker implements FriendChecker {
  /** Pairs stored in both directions for lookup simplicity — a test fake, not the normalized-storage adapter. */
  private pairs = new Set<string>();

  addFriendship(a: string, b: string): void {
    this.pairs.add(`${a.toLowerCase()}:${b.toLowerCase()}`);
    this.pairs.add(`${b.toLowerCase()}:${a.toLowerCase()}`);
  }

  async friendsAmong(userId: string, otherUserIds: string[]): Promise<Set<string>> {
    const me = userId.toLowerCase();
    return new Set(otherUserIds.filter((other) => this.pairs.has(`${me}:${other.toLowerCase()}`)));
  }
}

/**
 * A `SharesMirror` that plans nothing, for the application-layer tests that
 * are about split's own rules. Whether a mirror really reaches a ledger is
 * guarded at the HTTP layer instead, where `createApp` composes the real
 * `FinanceSharesMirror` — a fake that reimplemented category resolution here
 * would only ever agree with itself.
 */
export const noopSharesMirror: SharesMirror = {
  plan: async () => [],
  afterWrite: async () => {},
};

export class InMemorySplitExpenseRepository implements SplitExpenseRepository, SplitSpendingRepository {
  rows: SplitExpense[] = [];

  /**
   * Needs the group repository to mirror the adapter's group-membership clause
   * in the unfiltered listing, and optionally the directory to attach the
   * display names the adapter resolves with a `users` join.
   *
   * [financeTransactions] is where the mirrors go — **the same object the
   * finance endpoints read from**, not a list of this fake's own. Kept in its
   * own list, `/api/finance/transactions`, `/summary` and `/budgets` would see
   * nothing, which is the very problem the design moved mirror planning out of
   * the adapter to avoid. Optional only so the many application-layer tests
   * that predate mirrors keep constructing this with two arguments.
   */
  constructor(
    private readonly groups: InMemoryExpenseGroupRepository,
    private readonly users?: TestUserDirectory,
    private readonly financeTransactions?: InMemoryFinanceTransactionRepository,
  ) {}

  /**
   * Stands in for the adapter's `ON CONFLICT (user_id, split_expense_id) DO
   * UPDATE` plus the delete of anyone who no longer holds a share. It is an
   * upsert, not an append, for the same reason the SQL is: a share holder's
   * own recategorisation has to survive the payer's next edit, and a second
   * row for the same (user, split) must never appear.
   *
   * It proves nothing about that SQL — see `test/db` for that. It exists so
   * the HTTP-level guards can observe a mirror at all.
   */
  private async writeMirrors(splitExpenseId: string, mirrors: ShareMirrorRow[]): Promise<void> {
    const store = this.financeTransactions;
    if (!store) return;
    const holders = new Set(mirrors.map((mirror) => mirror.userId));
    store.transactions = store.transactions.filter((txn) => txn.splitExpenseId !== splitExpenseId || holders.has(txn.userId));

    for (const mirror of mirrors) {
      const existing = store.transactions.find((txn) => txn.splitExpenseId === splitExpenseId && txn.userId === mirror.userId);
      if (existing) {
        existing.amount = mirror.amount;
        existing.currency = mirror.currency;
        existing.date = mirror.day;
        // Only while the row still follows the split; `note` is never
        // rewritten, matching the adapter's SET list (D6/D18).
        if (existing.categorySource === "mirror") existing.categoryId = mirror.categoryId;
        continue;
      }
      await store.create({
        userId: mirror.userId,
        type: "expense",
        amount: mirror.amount,
        currency: mirror.currency,
        categoryId: mirror.categoryId,
        date: mirror.day,
        note: mirror.note,
        splitExpenseId: mirror.splitExpenseId,
        categorySource: "mirror",
      });
    }
  }

  private withNames(shares: SplitShareInput[]): SplitShare[] {
    return shares.map((share) => ({
      ...share,
      displayName: this.users ? this.users.get(share.userId) : share.userId,
    }));
  }

  async create(input: CreateSplitExpenseInput, mirrors: ShareMirrorRow[]): Promise<SplitExpense> {
    const now = new Date();
    const expense: SplitExpense = {
      ...input,
      payerDisplayName: this.users ? this.users.get(input.payerUserId) : input.payerUserId,
      shares: this.withNames(input.shares),
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(expense);
    await this.writeMirrors(input.id, mirrors);
    return expense;
  }

  async findById(id: string): Promise<SplitExpense | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async update(id: string, fields: UpdateSplitExpenseFields, mirrors: ShareMirrorRow[], now: Date, _actorUserId: string): Promise<SplitExpense | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    row.payerUserId = fields.payerUserId;
    row.payerDisplayName = this.users ? this.users.get(fields.payerUserId) : fields.payerUserId;
    row.amount = fields.amount;
    row.currency = fields.currency;
    row.description = fields.description;
    row.day = fields.day;
    row.splitMode = fields.splitMode;
    row.categoryName = fields.categoryName;
    row.shares = this.withNames(fields.shares);
    row.updatedAt = now;
    await this.writeMirrors(id, mirrors);
    return row;
  }

  async delete(id: string, _actorUserId: string, _now: Date): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    // Stands in for `finance_transaction.split_expense_id`'s `on delete
    // cascade`: the mirrors go with the expense, and no application code asks
    // for it.
    if (this.financeTransactions) {
      this.financeTransactions.transactions = this.financeTransactions.transactions.filter((txn) => txn.splitExpenseId !== id);
    }
    return true;
  }

  /**
   * Mirrors the real adapter's `EXISTS`-scoped SQL WHERE (participation), so
   * the use case's own re-assertion has something honest to check. The
   * unfiltered branch also mirrors the adapter's group-membership clause: a
   * grouped expense the caller can see through membership alone belongs in
   * the unfiltered listing, exactly as it does under `group_id=`.
   */
  async listForUser(userId: string, filter: ListExpensesFilter): Promise<SplitExpense[]> {
    const memberGroupIds = new Set((await this.groups.listForUser(userId)).map((group) => group.id));
    return this.rows.filter((row) => {
      if (filter.groupId !== undefined) return row.groupId === filter.groupId;
      const participates = row.payerUserId === userId || row.shares.some((s) => s.userId === userId);
      if (filter.withUserId !== undefined) {
        const other = filter.withUserId;
        const otherParticipates = row.payerUserId === other || row.shares.some((s) => s.userId === other);
        return row.groupId === null && participates && otherParticipates;
      }
      return participates || (row.groupId !== null && memberGroupIds.has(row.groupId));
    });
  }

  /**
   * Mirrors the real adapter's join + GROUP BY: sums `split_share.amount` for
   * `userId`'s own rows on expenses whose `day` falls in `month`, per
   * currency (currency lives on the expense, not the share). The payer's own
   * share counts — this is deliberately not the same filter `balancesForUser`
   * applies, see `SplitSpendingRepository.splitSpendingForUser`.
   */
  async splitSpendingForUser(userId: string, month: string): Promise<SplitSpendingAmount[]> {
    const totals = new Map<string, number>();
    for (const row of this.rows) {
      if (!row.day.startsWith(month)) continue;
      for (const share of row.shares) {
        if (share.userId !== userId) continue;
        totals.set(row.currency, (totals.get(row.currency) ?? 0) + share.amount);
      }
    }
    return [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
  }
}

export class InMemorySettlementRepository implements SettlementRepository {
  rows: Settlement[] = [];

  /**
   * Needs the group repository to mirror the adapter's group-membership
   * clause in the unfiltered listing — a settlement visible only through
   * group membership (neither party is the caller) still belongs there, the
   * same way `InMemorySplitExpenseRepository.listForUser` handles it.
   */
  constructor(
    private readonly groups?: InMemoryExpenseGroupRepository,
    private readonly users?: TestUserDirectory,
  ) {}

  private nameFor(userId: string): string {
    return this.users ? this.users.get(userId) : userId;
  }

  async create(input: CreateSettlementInput): Promise<Settlement> {
    const now = new Date();
    const settlement: Settlement = {
      ...input,
      fromDisplayName: this.nameFor(input.fromUserId),
      toDisplayName: this.nameFor(input.toUserId),
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(settlement);
    return settlement;
  }

  async findById(id: string): Promise<Settlement | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async delete(id: string, _actorUserId: string, _now: Date): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }

  /**
   * Mirrors the real adapter's participation-scoped SQL WHERE, the same way
   * `InMemorySplitExpenseRepository.listForUser` does for expenses.
   */
  async listForUser(userId: string, filter: ListSettlementsFilter): Promise<Settlement[]> {
    const memberGroupIds = this.groups ? new Set((await this.groups.listForUser(userId)).map((group) => group.id)) : new Set<string>();
    return this.rows.filter((row) => {
      if (filter.groupId !== undefined) return row.groupId === filter.groupId;
      const participates = row.fromUserId === userId || row.toUserId === userId;
      if (filter.withUserId !== undefined) {
        const other = filter.withUserId;
        const otherParticipates = row.fromUserId === other || row.toUserId === other;
        return row.groupId === null && participates && otherParticipates;
      }
      return participates || (row.groupId !== null && memberGroupIds.has(row.groupId));
    });
  }
}

/**
 * Computes balances from a `InMemorySplitExpenseRepository`'s stored rows —
 * a test fixture standing in for the real adapter's SQL aggregation, not a
 * production-scale implementation (design.md requires the real adapter to
 * aggregate in the database, never load every share into memory).
 */
export class InMemoryBalanceRepository implements BalanceRepository {
  /**
   * [settlements] is optional only so the many tests predating settle-up keep
   * constructing this with three arguments. Supplied, the fake folds
   * settlements in through the *same* pure functions the real CTEs are
   * transcribed from — which does not prove the SQL (nothing in CI can), but
   * does prove the route -> use case -> repository -> JSON path actually
   * carries a settlement into a reported balance. Without it that whole path
   * was unexercised and only the pure functions were under test.
   */
  constructor(
    private readonly expenses: InMemorySplitExpenseRepository,
    private readonly groups: InMemoryExpenseGroupRepository,
    private readonly users: TestUserDirectory,
    private readonly settlements?: InMemorySettlementRepository,
  ) {}

  async balancesForUser(userId: string): Promise<Balance[]> {
    const me = userId.toLowerCase();
    const net = new Map<string, Map<string, number>>();
    const addNet = (counterpart: string, currency: string, delta: number) => {
      if (!net.has(counterpart)) net.set(counterpart, new Map());
      const currencies = net.get(counterpart)!;
      currencies.set(currency, (currencies.get(currency) ?? 0) + delta);
    };

    for (const expense of this.expenses.rows) {
      const payer = expense.payerUserId;
      for (const share of expense.shares) {
        if (share.userId === payer) continue;
        if (payer === me) addNet(share.userId, expense.currency, share.amount);
        else if (share.userId === me) addNet(payer, expense.currency, -share.amount);
      }
    }

    // Personal rows are keyed by the counterpart, but the delta is computed
    // from *my* side — see `personalSettlementDelta`'s doc: passing the
    // counterpart instead silently inverts it.
    for (const settlement of this.settlements?.rows ?? []) {
      const other =
        settlement.fromUserId === me ? settlement.toUserId : settlement.toUserId === me ? settlement.fromUserId : null;
      if (other === null) continue;
      addNet(other, settlement.currency, personalSettlementDelta(settlement, me));
    }

    return toBalances(net, this.users);
  }

  async balancesForGroup(groupId: string): Promise<Balance[]> {
    const net = new Map<string, Map<string, number>>();
    const addNet = (userId: string, currency: string, delta: number) => {
      if (!net.has(userId)) net.set(userId, new Map());
      const currencies = net.get(userId)!;
      currencies.set(currency, (currencies.get(currency) ?? 0) + delta);
    };

    const members = await this.groups.listMembers(groupId);
    for (const member of members) {
      if (!net.has(member.userId)) net.set(member.userId, new Map());
    }

    for (const expense of this.expenses.rows.filter((row) => row.groupId === groupId)) {
      const payer = expense.payerUserId;
      for (const share of expense.shares) {
        if (share.userId === payer) continue;
        addNet(payer, expense.currency, share.amount);
        addNet(share.userId, expense.currency, -share.amount);
      }
    }

    // Group rows are keyed by the member themselves, so the subject and the
    // function's argument are the same person here — unlike the personal
    // query above.
    for (const settlement of (this.settlements?.rows ?? []).filter((row) => row.groupId === groupId)) {
      addNet(settlement.fromUserId, settlement.currency, groupSettlementDelta(settlement, settlement.fromUserId));
      addNet(settlement.toUserId, settlement.currency, groupSettlementDelta(settlement, settlement.toUserId));
    }

    return toBalances(net, this.users);
  }
}

/** Zero-net currencies are omitted from each entry, and an entry with nothing left is omitted entirely (design.md: a settled pair disappears). */
function toBalances(net: Map<string, Map<string, number>>, users: TestUserDirectory): Balance[] {
  const result: Balance[] = [];
  for (const [userId, currencies] of net) {
    const balances: CurrencyBalance[] = [];
    for (const [currency, amount] of currencies) {
      if (amount !== 0) balances.push({ currency, amount });
    }
    if (balances.length === 0) continue;
    result.push({ userId, displayName: users.get(userId), balances });
  }
  return result;
}

/**
 * Stores whole `SplitActivity` entries and applies the same visibility split
 * the real adapter's SQL does — a grouped entry against live membership, a
 * groupless one against its frozen `audienceUserIds`.
 *
 * **This fake proves nothing about that SQL.** It is here so a route test can
 * exercise handler -> use case -> repository -> JSON and the cursor paging;
 * the predicate itself is proven only in `test/db/split-activity-visibility.test.ts`,
 * against a real Postgres. Entries are seeded directly with `record` — the
 * write fakes above do not produce them, because in production the activity row
 * is written by the same SQL batch as the change, which no in-memory fake can
 * stand in for.
 */
export class InMemorySplitActivityRepository implements SplitActivityRepository {
  rows: (SplitActivity & { audienceUserIds: string[] | null })[] = [];

  constructor(private readonly groups?: InMemoryExpenseGroupRepository) {}

  record(entry: SplitActivity & { audienceUserIds: string[] | null }): void {
    this.rows.push(entry);
  }

  async listForUser(userId: string, options: ListActivityOptions): Promise<SplitActivity[]> {
    const memberGroupIds = this.groups ? new Set((await this.groups.listForUser(userId)).map((group) => group.id)) : new Set<string>();
    const visible = this.rows
      .filter((row) => (row.groupId === null ? (row.audienceUserIds ?? []).includes(userId) : memberGroupIds.has(row.groupId)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const before = options.before;
    const page = before
      ? visible.filter((row) => row.createdAt.getTime() < before.createdAt.getTime() || (row.createdAt.getTime() === before.createdAt.getTime() && row.id < before.id))
      : visible;
    return page.slice(0, options.limit);
  }
}
