import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { expenseGroupMember, splitSettlement, users } from "../../../shared/db/schema";
import { splitDisplayName } from "../domain/display-name";
import type { CreateSettlementInput, Settlement } from "../domain/settlement";
import type { ListSettlementsFilter, SettlementRepository } from "../domain/settlement-repository";

type SettlementRow = typeof splitSettlement.$inferSelect;

function toSettlement(row: SettlementRow, names: Map<string, string>): Settlement {
  return {
    id: row.id,
    groupId: row.groupId,
    fromUserId: row.fromUserId,
    fromDisplayName: names.get(row.fromUserId) ?? row.fromUserId,
    toUserId: row.toUserId,
    toDisplayName: names.get(row.toUserId) ?? row.toUserId,
    amount: row.amount,
    currency: row.currency,
    day: row.day,
    note: row.note,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** `userId` is one of the settlement's two named parties — the only kind of participation a settlement has (no shares table). */
function participatesIn(userId: string) {
  return or(eq(splitSettlement.fromUserId, userId), eq(splitSettlement.toUserId, userId));
}

/** `userId` can see a *grouped* settlement by being a member of its group, mirroring `memberOfExpenseGroup` in the expense adapter. */
function memberOfSettlementGroup(db: Db, userId: string) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(expenseGroupMember)
      .where(and(eq(expenseGroupMember.groupId, splitSettlement.groupId), eq(expenseGroupMember.userId, userId))),
  );
}

/** Driven adapter: implements SettlementRepository via Drizzle + Neon. */
export class DrizzleSettlementRepository implements SettlementRepository {
  constructor(private readonly getDb: () => Db) {}

  /** A single-row insert — no `db.batch` needed, unlike expenses (design.md: no shares to keep atomic with it). */
  async create(input: CreateSettlementInput): Promise<Settlement> {
    const db = this.getDb();
    const now = new Date();
    const [row] = await db
      .insert(splitSettlement)
      .values({
        id: input.id,
        groupId: input.groupId,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: input.amount,
        currency: input.currency,
        day: input.day,
        note: input.note,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("failed to create settlement");
    const names = await this.namesFor([row.fromUserId, row.toUserId]);
    return toSettlement(row, names);
  }

  async findById(id: string): Promise<Settlement | null> {
    const db = this.getDb();
    const [row] = await db.select().from(splitSettlement).where(eq(splitSettlement.id, id)).limit(1);
    if (!row) return null;
    const names = await this.namesFor([row.fromUserId, row.toUserId]);
    return toSettlement(row, names);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.getDb().delete(splitSettlement).where(eq(splitSettlement.id, id)).returning({ id: splitSettlement.id });
    return deleted.length > 0;
  }

  /**
   * `userId`'s settlements matching `filter`, scoped in SQL (same shape as
   * `DrizzleSplitExpenseRepository.listForUser`). `group_id=<id>` returns
   * every settlement in that group — the use case has already verified the
   * caller is a member before calling this. `with=<userId>` is groupless
   * settlements naming exactly this pair (a settlement only ever names two
   * people, so "both participate" already pins the pair). Neither given lists
   * everything the caller is a party to, plus anything visible through group
   * membership alone.
   */
  async listForUser(userId: string, filter: ListSettlementsFilter): Promise<Settlement[]> {
    const db = this.getDb();

    const where =
      filter.groupId !== undefined
        ? eq(splitSettlement.groupId, filter.groupId)
        : filter.withUserId !== undefined
          ? and(isNull(splitSettlement.groupId), participatesIn(userId), participatesIn(filter.withUserId))
          : or(participatesIn(userId), memberOfSettlementGroup(db, userId));

    const rows = await db.select().from(splitSettlement).where(where);
    if (rows.length === 0) return [];

    const names = await this.namesFor([...rows.map((row) => row.fromUserId), ...rows.map((row) => row.toUserId)]);
    return rows.map((row) => toSettlement(row, names));
  }

  private async namesFor(userIds: string[]): Promise<Map<string, string>> {
    const distinct = [...new Set(userIds)];
    if (distinct.length === 0) return new Map();
    const rows = await this.getDb()
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(inArray(users.id, distinct));
    return new Map(rows.map((row) => [row.id, splitDisplayName(row.displayName, row.email)]));
  }
}
