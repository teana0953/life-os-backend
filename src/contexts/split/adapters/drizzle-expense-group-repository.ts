import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { expenseGroup, expenseGroupMember } from "../../../shared/db/schema";
import type { CreateExpenseGroupInput, ExpenseGroup, GroupMember } from "../domain/expense-group";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";

type ExpenseGroupRow = typeof expenseGroup.$inferSelect;
type GroupMemberRow = typeof expenseGroupMember.$inferSelect;

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

function toMember(row: GroupMemberRow): GroupMember {
  return { groupId: row.groupId, userId: row.userId, joinedAt: row.joinedAt };
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
    return toMember(row);
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const rows = await this.getDb().select().from(expenseGroupMember).where(eq(expenseGroupMember.groupId, groupId));
    return rows.map(toMember);
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
