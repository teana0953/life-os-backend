/**
 * Driven adapter for net worth.
 *
 * **This file reads only its own two tables — never `finance_transaction`.**
 * That is why mirroring split shares into the ledger leaves net worth and its
 * trend untouched, and why there is no test asserting so: nothing in that
 * change could make such a test fail, and a guard that cannot fail is worse
 * than none (`split-bills` spec: state it where the code is instead).
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { financeNetworthAccount, financeNetworthSnapshot } from "../../../shared/db/schema";
import type { CreateNetWorthAccountInput, NetWorthAccount, NetWorthKind, UpdateNetWorthAccountPatch } from "../domain/networth-account";
import type { MonthlyNetWorthTotals, NetWorthRepository } from "../domain/networth-repository";
import type { NetWorthAccountValue, NetWorthSnapshot, NetWorthTrendPoint, UpsertNetWorthSnapshotInput } from "../domain/networth-snapshot";

type NetWorthAccountRow = typeof financeNetworthAccount.$inferSelect;
type NetWorthSnapshotRow = typeof financeNetworthSnapshot.$inferSelect;

function accountToDomain(row: NetWorthAccountRow): NetWorthAccount {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as NetWorthKind,
    name: row.name,
    sortOrder: row.sortOrder,
    archived: row.archived,
  };
}

function snapshotToDomain(row: NetWorthSnapshotRow): NetWorthSnapshot {
  return { id: row.id, userId: row.userId, accountId: row.accountId, month: row.month, value: row.value };
}

export class DrizzleNetWorthRepository implements NetWorthRepository {
  constructor(private readonly getDb: () => Db) {}

  async listAccounts(userId: string): Promise<NetWorthAccount[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(financeNetworthAccount)
      .where(eq(financeNetworthAccount.userId, userId))
      .orderBy(asc(financeNetworthAccount.kind), asc(financeNetworthAccount.sortOrder));
    return rows.map(accountToDomain);
  }

  async findAccountById(id: string): Promise<NetWorthAccount | null> {
    const db = this.getDb();
    const [row] = await db.select().from(financeNetworthAccount).where(eq(financeNetworthAccount.id, id)).limit(1);
    return row ? accountToDomain(row) : null;
  }

  async findAccountByUserKindName(userId: string, kind: NetWorthKind, name: string): Promise<NetWorthAccount | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(financeNetworthAccount)
      .where(and(eq(financeNetworthAccount.userId, userId), eq(financeNetworthAccount.kind, kind), eq(financeNetworthAccount.name, name)))
      .limit(1);
    return row ? accountToDomain(row) : null;
  }

  async createAccount(input: CreateNetWorthAccountInput): Promise<NetWorthAccount> {
    const db = this.getDb();
    const [row] = await db
      .insert(financeNetworthAccount)
      .values({ userId: input.userId, kind: input.kind, name: input.name, sortOrder: input.sortOrder ?? 0 })
      .returning();
    if (!row) throw new Error("failed to create net-worth account");
    return accountToDomain(row);
  }

  async updateAccount(userId: string, id: string, patch: UpdateNetWorthAccountPatch): Promise<NetWorthAccount | null> {
    const db = this.getDb();
    // `updatedAt` has `defaultNow()` but that only fires on insert; every update sets it explicitly.
    const values: Partial<typeof financeNetworthAccount.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
    if (patch.archived !== undefined) values.archived = patch.archived;

    const [row] = await db
      .update(financeNetworthAccount)
      .set(values)
      .where(and(eq(financeNetworthAccount.id, id), eq(financeNetworthAccount.userId, userId)))
      .returning();
    return row ? accountToDomain(row) : null;
  }

  /**
   * All-or-nothing: one `db.batch` of per-account `UPDATE`s setting `sortOrder`
   * to each id's index in `orderedIds`, scoped to `(userId, kind)` on every
   * statement as defense in depth (the `reorderNetWorthAccounts` use case is
   * what actually validates `orderedIds` against the owned set). `drizzle-orm/
   * neon-http` has no `transaction()`, so `db.batch` — one READ COMMITTED
   * round trip — is the only atomic unit available (see
   * `drizzle-split-expense-repository.ts` for the same pattern).
   */
  async reorderAccounts(userId: string, kind: NetWorthKind, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    const db = this.getDb();
    const [first, ...rest] = orderedIds.map((id, index) =>
      db
        .update(financeNetworthAccount)
        .set({ sortOrder: index, updatedAt: new Date() })
        .where(and(eq(financeNetworthAccount.id, id), eq(financeNetworthAccount.userId, userId), eq(financeNetworthAccount.kind, kind))),
    );
    await db.batch([first, ...rest]);
  }

  async insertDefaultAccountsIfMissing(defaults: CreateNetWorthAccountInput[]): Promise<void> {
    if (defaults.length === 0) return;
    const db = this.getDb();
    await db
      .insert(financeNetworthAccount)
      .values(defaults.map((d) => ({ userId: d.userId, kind: d.kind, name: d.name, sortOrder: d.sortOrder ?? 0 })))
      // The (user_id, kind, name) unique index makes this the concurrency
      // safety net behind ensureDefaultAccounts' "seed only if empty" check.
      .onConflictDoNothing();
  }

  async upsertSnapshot(input: UpsertNetWorthSnapshotInput): Promise<NetWorthSnapshot> {
    const db = this.getDb();
    const [row] = await db
      .insert(financeNetworthSnapshot)
      .values({ userId: input.userId, accountId: input.accountId, month: input.month, value: input.value })
      .onConflictDoUpdate({
        target: [financeNetworthSnapshot.accountId, financeNetworthSnapshot.month],
        set: { value: input.value, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("failed to upsert net-worth snapshot");
    return snapshotToDomain(row);
  }

  async listMonthValues(userId: string, month: string): Promise<NetWorthAccountValue[]> {
    const db = this.getDb();
    const rows = await db
      .select({
        accountId: financeNetworthSnapshot.accountId,
        kind: financeNetworthAccount.kind,
        name: financeNetworthAccount.name,
        value: financeNetworthSnapshot.value,
      })
      .from(financeNetworthSnapshot)
      .innerJoin(financeNetworthAccount, eq(financeNetworthSnapshot.accountId, financeNetworthAccount.id))
      .where(and(eq(financeNetworthSnapshot.userId, userId), eq(financeNetworthSnapshot.month, month)))
      .orderBy(asc(financeNetworthAccount.kind), asc(financeNetworthAccount.sortOrder));
    return rows.map((r) => ({ accountId: r.accountId, kind: r.kind as NetWorthKind, name: r.name, value: r.value }));
  }

  async getMonthlyTotals(userId: string, month: string): Promise<MonthlyNetWorthTotals> {
    const db = this.getDb();
    // Both kinds are stored positive; SUM per kind (SUM(integer) returns bigint,
    // surfaced as a string, so cast to number). Includes archived accounts'
    // historical snapshots — archived only blocks new writes (design.md).
    const rows = await db
      .select({
        kind: financeNetworthAccount.kind,
        total: sql<string>`SUM(${financeNetworthSnapshot.value})`,
      })
      .from(financeNetworthSnapshot)
      .innerJoin(financeNetworthAccount, eq(financeNetworthSnapshot.accountId, financeNetworthAccount.id))
      .where(and(eq(financeNetworthSnapshot.userId, userId), eq(financeNetworthSnapshot.month, month)))
      .groupBy(financeNetworthAccount.kind);

    let totalAsset = 0;
    let totalLiability = 0;
    for (const r of rows) {
      if (r.kind === "liability") totalLiability = Number(r.total);
      else totalAsset = Number(r.total);
    }
    return { totalAsset, totalLiability };
  }

  async findPreviousSnapshotMonth(userId: string, month: string): Promise<string | null> {
    const db = this.getDb();
    const [row] = await db
      .selectDistinct({ month: financeNetworthSnapshot.month })
      .from(financeNetworthSnapshot)
      .where(and(eq(financeNetworthSnapshot.userId, userId), sql`${financeNetworthSnapshot.month} < ${month}`))
      .orderBy(desc(financeNetworthSnapshot.month))
      .limit(1);
    return row?.month ?? null;
  }

  async getTrend(userId: string, from: string, to: string): Promise<NetWorthTrendPoint[]> {
    const db = this.getDb();
    // Net worth per month = SUM(asset) − SUM(liability); express as a signed sum
    // so a single group-by yields the net directly (bigint -> string -> number).
    const rows = await db
      .select({
        month: financeNetworthSnapshot.month,
        netWorth: sql<string>`SUM(CASE WHEN ${financeNetworthAccount.kind} = 'liability' THEN -${financeNetworthSnapshot.value} ELSE ${financeNetworthSnapshot.value} END)`,
      })
      .from(financeNetworthSnapshot)
      .innerJoin(financeNetworthAccount, eq(financeNetworthSnapshot.accountId, financeNetworthAccount.id))
      .where(
        and(
          eq(financeNetworthSnapshot.userId, userId),
          gte(financeNetworthSnapshot.month, from),
          lte(financeNetworthSnapshot.month, to),
        ),
      )
      .groupBy(financeNetworthSnapshot.month)
      .orderBy(asc(financeNetworthSnapshot.month));
    return rows.map((r) => ({ month: r.month, netWorth: Number(r.netWorth) }));
  }
}
