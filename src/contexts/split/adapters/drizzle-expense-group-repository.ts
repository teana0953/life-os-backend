import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../../../shared/db/client";
import { expenseGroup, expenseGroupMember, users } from "../../../shared/db/schema";
import type { CreateExpenseGroupInput, ExpenseGroup, GroupMember } from "../domain/expense-group";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import { splitDisplayName } from "../domain/display-name";

type ExpenseGroupRow = typeof expenseGroup.$inferSelect;
type GroupMemberRow = typeof expenseGroupMember.$inferSelect;
type MemberUserRow = { displayName: string | null; email: string };

function toGroup(row: ExpenseGroupRow): ExpenseGroup {
  return {
    id: row.id,
    name: row.name,
    createdByUserId: row.createdByUserId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMember(row: GroupMemberRow, user: MemberUserRow): GroupMember {
  return {
    groupId: row.groupId,
    userId: row.userId,
    displayName: splitDisplayName(user.displayName, user.email),
    joinedAt: row.joinedAt,
  };
}

/** Driven adapter: implements ExpenseGroupRepository via Drizzle + Neon. */
export class DrizzleExpenseGroupRepository implements ExpenseGroupRepository {
  constructor(private readonly getDb: () => Db) {}

  /**
   * The creator becomes the first member in the same write (design.md:
   * "建立者自動入組"). The id is generated up front, the same reason
   * `split_expense` generates its own — the member row's `group_id` must be
   * known before the batch is sent, and neon-http's `db.batch` cannot chain a
   * generated id from one statement into the next.
   */
  async create(input: CreateExpenseGroupInput): Promise<ExpenseGroup> {
    const db = this.getDb();
    const id = crypto.randomUUID();
    const now = new Date();
    const groupInsert = db.insert(expenseGroup).values({
      id,
      name: input.name,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
    const memberInsert = db.insert(expenseGroupMember).values({ groupId: id, userId: input.createdByUserId, joinedAt: now });
    await db.batch([groupInsert, memberInsert]);
    return { id, name: input.name, createdByUserId: input.createdByUserId, archivedAt: null, createdAt: now, updatedAt: now };
  }

  async findById(id: string): Promise<ExpenseGroup | null> {
    const [row] = await this.getDb().select().from(expenseGroup).where(eq(expenseGroup.id, id)).limit(1);
    return row ? toGroup(row) : null;
  }

  async listForUser(userId: string): Promise<ExpenseGroup[]> {
    const rows = await this.getDb()
      .select({ group: expenseGroup })
      .from(expenseGroupMember)
      .innerJoin(expenseGroup, eq(expenseGroup.id, expenseGroupMember.groupId))
      .where(eq(expenseGroupMember.userId, userId));
    return rows.map((row) => toGroup(row.group));
  }

  async archive(id: string, now: Date): Promise<boolean> {
    const updated = await this.getDb()
      .update(expenseGroup)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(expenseGroup.id, id))
      .returning({ id: expenseGroup.id });
    return updated.length > 0;
  }

  async addMember(groupId: string, userId: string, now: Date): Promise<GroupMember> {
    const [row] = await this.getDb().insert(expenseGroupMember).values({ groupId, userId, joinedAt: now }).returning();
    if (!row) throw new Error("failed to add group member");
    const [user] = await this.getDb()
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new Error("failed to resolve group member");
    return toMember(row, user);
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const rows = await this.getDb()
      .select({ member: expenseGroupMember, displayName: users.displayName, email: users.email })
      .from(expenseGroupMember)
      .innerJoin(users, eq(users.id, expenseGroupMember.userId))
      .where(eq(expenseGroupMember.groupId, groupId));
    return rows.map((row) => toMember(row.member, { displayName: row.displayName, email: row.email }));
  }

  async listMembersForGroups(groupIds: string[]): Promise<GroupMember[]> {
    if (groupIds.length === 0) return [];
    const rows = await this.getDb()
      .select({ member: expenseGroupMember, displayName: users.displayName, email: users.email })
      .from(expenseGroupMember)
      .innerJoin(users, eq(users.id, expenseGroupMember.userId))
      .where(inArray(expenseGroupMember.groupId, groupIds));
    return rows.map((row) => toMember(row.member, { displayName: row.displayName, email: row.email }));
  }

  /**
   * A self-join on membership: one row is enough, so `limit(1)` — this is a
   * predicate, not a listing, and the pair may share many groups.
   */
  async shareAnyGroup(userId: string, otherUserId: string): Promise<boolean> {
    const mine = alias(expenseGroupMember, "mine");
    const theirs = alias(expenseGroupMember, "theirs");
    const rows = await this.getDb()
      .select({ groupId: mine.groupId })
      .from(mine)
      .innerJoin(theirs, eq(theirs.groupId, mine.groupId))
      .where(and(eq(mine.userId, userId), eq(theirs.userId, otherUserId)))
      .limit(1);
    return rows.length > 0;
  }

  async membersAmong(groupId: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.getDb()
      .select({ userId: expenseGroupMember.userId })
      .from(expenseGroupMember)
      .where(and(eq(expenseGroupMember.groupId, groupId), inArray(expenseGroupMember.userId, userIds)));
    return new Set(rows.map((row) => row.userId));
  }
}
