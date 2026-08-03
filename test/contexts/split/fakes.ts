import type { Balance, CurrencyBalance } from "../../../src/contexts/split/domain/balance";
import type { BalanceRepository } from "../../../src/contexts/split/domain/balance-repository";
import type { CreateExpenseGroupInput, ExpenseGroup, GroupMember } from "../../../src/contexts/split/domain/expense-group";
import type { ExpenseGroupRepository } from "../../../src/contexts/split/domain/expense-group-repository";
import type { FriendChecker } from "../../../src/contexts/split/domain/friend-checker";
import { groupSettlementDelta, personalSettlementDelta } from "../../../src/contexts/split/domain/settlement-balance";
import type { CreateSettlementInput, Settlement } from "../../../src/contexts/split/domain/settlement";
import type { ListSettlementsFilter, SettlementRepository } from "../../../src/contexts/split/domain/settlement-repository";
import type { CreateSplitExpenseInput, SplitExpense, SplitShare, SplitShareInput, UpdateSplitExpenseFields } from "../../../src/contexts/split/domain/split-expense";
import type { ListExpensesFilter, SplitExpenseRepository } from "../../../src/contexts/split/domain/split-expense-repository";
import type { SplitSpendingAmount } from "../../../src/contexts/split/domain/split-spending";
import type { SplitSpendingRepository } from "../../../src/contexts/split/domain/split-spending-repository";

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

  async archive(id: string, now: Date): Promise<boolean> {
    const group = this.groups.find((g) => g.id === id);
    if (!group) return false;
    group.archivedAt = now;
    return true;
  }

  async addMember(groupId: string, userId: string, now: Date): Promise<GroupMember> {
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

export class InMemorySplitExpenseRepository implements SplitExpenseRepository, SplitSpendingRepository {
  rows: SplitExpense[] = [];

  /**
   * Needs the group repository to mirror the adapter's group-membership clause
   * in the unfiltered listing, and optionally the directory to attach the
   * display names the adapter resolves with a `users` join.
   */
  constructor(
    private readonly groups: InMemoryExpenseGroupRepository,
    private readonly users?: TestUserDirectory,
  ) {}

  private withNames(shares: SplitShareInput[]): SplitShare[] {
    return shares.map((share) => ({
      ...share,
      displayName: this.users ? this.users.get(share.userId) : share.userId,
    }));
  }

  async create(input: CreateSplitExpenseInput): Promise<SplitExpense> {
    const now = new Date();
    const expense: SplitExpense = {
      ...input,
      payerDisplayName: this.users ? this.users.get(input.payerUserId) : input.payerUserId,
      shares: this.withNames(input.shares),
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(expense);
    return expense;
  }

  async findById(id: string): Promise<SplitExpense | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async update(id: string, fields: UpdateSplitExpenseFields, now: Date): Promise<SplitExpense | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    row.payerUserId = fields.payerUserId;
    row.payerDisplayName = this.users ? this.users.get(fields.payerUserId) : fields.payerUserId;
    row.amount = fields.amount;
    row.currency = fields.currency;
    row.description = fields.description;
    row.day = fields.day;
    row.splitMode = fields.splitMode;
    row.shares = this.withNames(fields.shares);
    row.updatedAt = now;
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
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

  async delete(id: string): Promise<boolean> {
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
