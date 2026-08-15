import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../../../shared/db/client";
import { expenseGroup, expenseGroupMember, splitActivity, users } from "../../../shared/db/schema";
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
    // Grouped, so no frozen audience: it is shown to the group's current
    // members, which at this instant is the creator and later everyone added
    // — deliberately, so a member who joins next month can still see the group
    // being created (tasks 1b.4).
    const activityInsert = db.insert(splitActivity).values({
      type: "group_created",
      actorUserId: input.createdByUserId,
      groupId: id,
      subjectId: id,
      createdAt: now,
    });
    await db.batch([groupInsert, memberInsert, activityInsert]);
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

  /**
   * Archiving and its activity entry in one batch, both conditional on the
   * group not being archived **already**.
   *
   * The row is indeed never deleted (that premise still holds, and is what
   * makes `split_activity.group_id` safe as a foreign key) — but "the row is
   * there" was never the condition that mattered here. `archived_at` is a
   * one-way transition, so the reachable wrong state is the *second* archive:
   * a plain `where id = ?` matches an already-archived group, and a
   * double-tapped button makes the timeline say the group was archived twice.
   *
   * Both statements carry the `archived_at is null` predicate, so there is no
   * read-then-write anywhere: a *sequential* second caller's UPDATE matches
   * nothing, its `INSERT ... SELECT` selects nothing, and `false` comes back.
   *
   * **The predicate alone does not survive concurrency — `for update of g`
   * does.** `db.batch` is one READ COMMITTED transaction and each statement in
   * it takes its own snapshot, so two concurrent *first* archives would both
   * see `archived_at is null` at their INSERT and both write an entry, while
   * only one UPDATE matches: the timeline would say the group was archived
   * twice, which is the state task 2.3c exists to prevent, and the loser would
   * get `false` back on top of it. Locking the group row in the INSERT
   * serialises the two: the second one re-checks after the first commits, sees
   * `archived_at` set, selects nothing, and its UPDATE matches nothing too.
   *
   * **UNPROVEN BY THIS SUITE**: PGlite is a single connection, so no test here
   * can overlap two of these transactions. Only the emitted SQL is asserted
   * (split-activity-write.test.ts, "the emitted SQL takes a row lock"); the
   * race is argued from Postgres' READ COMMITTED semantics, not demonstrated.
   *
   * **ORDER: the insert comes BEFORE the update**, for the same reason as the
   * two deletes — after it, `archived_at` is already set inside this
   * transaction, the SELECT matches nothing and the entry is silently never
   * written.
   */
  async archive(id: string, now: Date, actorUserId: string): Promise<boolean> {
    const db = this.getDb();
    const activityInsert = db.execute(sql`
      insert into ${splitActivity} (type, actor_user_id, group_id, subject_id, created_at)
      select 'group_archived', ${actorUserId}::uuid, g.id, g.id, ${now.toISOString()}::timestamptz
      from ${expenseGroup} g
      where g.id = ${id}::uuid and g.archived_at is null
      for update of g
    `);
    const groupUpdate = db
      .update(expenseGroup)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(expenseGroup.id, id), isNull(expenseGroup.archivedAt)))
      .returning({ id: expenseGroup.id });
    const [, updated] = await db.batch([activityInsert, groupUpdate]);
    return updated.length > 0;
  }

  /** The membership row and its activity entry in one batch — `actorUserId` is who did the adding, `userId` who was added. */
  async addMember(groupId: string, userId: string, now: Date, actorUserId: string): Promise<GroupMember> {
    const db = this.getDb();
    const memberInsert = db.insert(expenseGroupMember).values({ groupId, userId, joinedAt: now }).returning();
    const activityInsert = db.insert(splitActivity).values({
      type: "group_member_added",
      actorUserId,
      groupId,
      subjectId: groupId,
      counterpartUserId: userId,
      createdAt: now,
    });
    const [[row]] = await db.batch([memberInsert, activityInsert]);
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
