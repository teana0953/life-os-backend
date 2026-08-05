import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { expenseGroupMember, splitActivity, splitSettlement, users } from "../../../shared/db/schema";
import { grouplessAudience } from "./split-activity-audience";
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

  /**
   * The settlement row and its activity entry in one `db.batch`. The row alone
   * would need no batch (there are no shares to keep atomic with it, unlike an
   * expense), but a repayment that lands without its timeline entry is a
   * balance that moved with nothing to explain it (design.md D3).
   *
   * The actor is `createdByUserId`, and the use case has already established
   * they are one of the two parties — so the counterpart is simply the other
   * one, and `actor_is_payer` says which of the two they are. Recording the
   * direction is not a nicety: actor, counterpart and amount are byte-identical
   * whether the actor paid or was paid, and the settlement row is the only
   * other place the direction exists — which is exactly the row `delete` below
   * removes.
   */
  async create(input: CreateSettlementInput): Promise<Settlement> {
    const db = this.getDb();
    const now = new Date();
    const settlementInsert = db
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
    const activityInsert = db.insert(splitActivity).values({
      type: "settlement_created",
      actorUserId: input.createdByUserId,
      groupId: input.groupId,
      subjectId: input.id,
      counterpartUserId: input.createdByUserId === input.fromUserId ? input.toUserId : input.fromUserId,
      // `null` if the actor is somehow neither party, rather than a `false`
      // that would read as "the counterpart paid them". The table's CHECK
      // turns that into a failed write instead of a plausible-looking lie.
      actorIsPayer:
        input.createdByUserId === input.fromUserId ? true : input.createdByUserId === input.toUserId ? false : null,
      amount: input.amount,
      currency: input.currency,
      audienceUserIds:
        input.groupId === null ? grouplessAudience([input.createdByUserId, input.fromUserId, input.toUserId]) : null,
      createdAt: now,
    });
    const [[row]] = await db.batch([settlementInsert, activityInsert]);
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

  /**
   * Same shape as `DrizzleSplitExpenseRepository.delete`, and for the same two
   * reasons: the snapshot (amount, currency, who paid whom — hence
   * `actor_is_payer`, computed here from the row that is about to vanish) only
   * exists while the row does, and the entry must not be written unless the
   * delete really matched a row — a check made before the batch would let two
   * concurrent deletes both record one.
   *
   * **LOCK: `for update of s` is what makes the condition hold under
   * concurrency**, and it is not decoration. `db.batch` is one READ COMMITTED
   * transaction whose statements each take their own snapshot, so without the
   * lock this INSERT can still see the row while the DELETE below matches
   * nothing — an entry committed for a repayment this request did not delete,
   * with a 404 going back to the caller. See the longer note on the expense
   * repository, including why the `array_agg` does not conflict with the lock
   * and why the suite cannot prove the race is closed.
   *
   * **ORDER: the insert comes BEFORE the delete.** After it, the SELECT finds
   * nothing inside the same transaction and silently records nothing, forever,
   * with no test going red. See the longer note on the expense repository.
   *
   * **CLOCK: `created_at` is the caller's `now` (the Worker's clock), never the
   * database's `now()`** — same reason as the expense delete, see the longer
   * note there: `now()` is microsecond-resolution, the timeline's cursor is
   * millisecond-resolution, and the entries below such a row become unreachable.
   */
  async delete(id: string, actorUserId: string, now: Date): Promise<boolean> {
    const db = this.getDb();
    const activityInsert = db.execute(sql`
      insert into ${splitActivity}
        (type, actor_user_id, group_id, subject_id, counterpart_user_id, actor_is_payer, amount, currency, audience_user_ids, created_at)
      select
        'settlement_deleted',
        ${actorUserId}::uuid,
        s.group_id,
        s.id,
        case when s.from_user_id = ${actorUserId}::uuid then s.to_user_id else s.from_user_id end,
        -- The direction dies with the row: after this batch nothing anywhere
        -- says which way the money went. NULL (not a bare
        -- "s.from_user_id = actor", which would call an outsider the payee)
        -- when the actor is neither party, which the table's CHECK rejects.
        case
          when s.from_user_id = ${actorUserId}::uuid then true
          when s.to_user_id = ${actorUserId}::uuid then false
        end,
        s.amount,
        s.currency,
        case when s.group_id is null then (
          select array_agg(distinct party)
          from unnest(array[${actorUserId}::uuid, s.from_user_id, s.to_user_id]) as party
        ) end,
        ${now.toISOString()}::timestamptz
      from ${splitSettlement} s
      where s.id = ${id}::uuid
      for update of s
    `);
    const settlementDelete = db.delete(splitSettlement).where(eq(splitSettlement.id, id)).returning({ id: splitSettlement.id });
    const [, deleted] = await db.batch([activityInsert, settlementDelete]);
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
