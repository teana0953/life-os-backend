import { and, desc, eq, exists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../../../shared/db/client";
import { expenseGroup, expenseGroupMember, splitActivity, users } from "../../../shared/db/schema";
import { splitDisplayName } from "../domain/display-name";
import type { SplitActivity, SplitActivityType } from "../domain/split-activity";
import type { ListActivityOptions, SplitActivityRepository } from "../domain/split-activity-repository";

/**
 * `userId` may see this entry. **This predicate is the security boundary of the
 * whole feature** — an entry carries someone else's amounts and descriptions,
 * so a mistake here is a data leak, not a wrong number.
 *
 * It is two rules, not one, and each half has its own reason (design.md D2):
 *
 * - **Grouped entry** (`group_id` set): the group's *current* members. Groups
 *   are never deleted, so the membership table is a live and reliable source,
 *   and this is already how `listForUser` decides who sees a group's expenses.
 *   Freezing it instead would let the timeline and the expense list disagree
 *   about whether you belong to a group. It also means a member who joins
 *   later sees the group's earlier activity — the same thing that already
 *   happens with its earlier expenses.
 * - **Groupless entry**: the audience frozen into the row when it was written.
 *   There is nothing live to consult: a groupless expense's participants are
 *   its `split_share` rows, which cascade away with the expense — and a
 *   deletion is precisely the event this table exists to preserve.
 *
 * The two branches are mutually exclusive by a CHECK constraint on the table,
 * so exactly one applies to any row.
 */
function visibleTo(db: Db, userId: string) {
  return sql`(
    case when ${splitActivity.groupId} is null
      then ${userId}::uuid = any(${splitActivity.audienceUserIds})
      else ${exists(
        db
          .select({ one: sql`1` })
          .from(expenseGroupMember)
          .where(and(eq(expenseGroupMember.groupId, splitActivity.groupId), eq(expenseGroupMember.userId, userId))),
      )}
    end
  )`;
}

/** Driven adapter: implements SplitActivityRepository via Drizzle + Neon. */
export class DrizzleSplitActivityRepository implements SplitActivityRepository {
  constructor(private readonly getDb: () => Db) {}

  async listForUser(userId: string, options: ListActivityOptions): Promise<SplitActivity[]> {
    const db = this.getDb();
    const actor = alias(users, "actor");
    const counterpart = alias(users, "counterpart");

    // Keyset, not offset: `(created_at, id) < (cursor)` as a row comparison,
    // so entries written in the same batch — which share a timestamp — are
    // never skipped or repeated across pages.
    const before = options.before;
    const where = before
      ? and(visibleTo(db, userId), sql`(${splitActivity.createdAt}, ${splitActivity.id}) < (${before.createdAt}, ${before.id}::uuid)`)
      : visibleTo(db, userId);

    const rows = await db
      .select({
        activity: splitActivity,
        actorDisplayName: actor.displayName,
        actorEmail: actor.email,
        groupName: expenseGroup.name,
        counterpartDisplayName: counterpart.displayName,
        counterpartEmail: counterpart.email,
      })
      .from(splitActivity)
      // `actor` is NOT NULL and references `users`, so an inner join would be
      // equivalent — a left join keeps a missing row from silently dropping
      // the entry, which is the failure mode that hides changes.
      .leftJoin(actor, eq(actor.id, splitActivity.actorUserId))
      .leftJoin(expenseGroup, eq(expenseGroup.id, splitActivity.groupId))
      .leftJoin(counterpart, eq(counterpart.id, splitActivity.counterpartUserId))
      .where(where)
      .orderBy(desc(splitActivity.createdAt), desc(splitActivity.id))
      .limit(options.limit);

    return rows.map((row) => ({
      id: row.activity.id,
      type: row.activity.type as SplitActivityType,
      actorUserId: row.activity.actorUserId,
      actorDisplayName: row.actorEmail === null ? row.activity.actorUserId : splitDisplayName(row.actorDisplayName, row.actorEmail),
      groupId: row.activity.groupId,
      groupName: row.groupName,
      subjectId: row.activity.subjectId,
      counterpartUserId: row.activity.counterpartUserId,
      counterpartDisplayName: row.counterpartEmail === null ? null : splitDisplayName(row.counterpartDisplayName, row.counterpartEmail),
      amount: row.activity.amount,
      previousAmount: row.activity.previousAmount,
      actorIsPayer: row.activity.actorIsPayer,
      currency: row.activity.currency,
      description: row.activity.description,
      createdAt: row.activity.createdAt,
    }));
  }
}
