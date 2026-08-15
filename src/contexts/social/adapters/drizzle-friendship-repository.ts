import { and, eq, or, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { friendship, users } from "../../../shared/db/schema";
import { type Friend, friendDisplayName } from "../domain/friend-user";
import { normalizePair } from "../domain/friendship";
import type { FriendshipRepository } from "../domain/friendship-repository";

/**
 * The only `users` columns this context ever reads. Selecting the list
 * explicitly (never `select *`) keeps an email from riding along by accident,
 * and `toFriend` turns the row into the outward `Friend` before it leaves the
 * adapter — which has nowhere to put an address (add-friends/design.md
 * "資訊揭露原則").
 */
const friendUserColumns = {
  userId: users.id,
  displayName: users.displayName,
  email: users.email,
};

type FriendUserRow = { userId: string; displayName: string | null; email: string };

/** The one place an address is read, and it does not survive the call. */
function toFriend(row: FriendUserRow): Friend {
  return { userId: row.userId, displayName: friendDisplayName(row.displayName, row.email) };
}

export class DrizzleFriendshipRepository implements FriendshipRepository {
  constructor(private readonly getDb: () => Db) {}

  async listFriends(userId: string): Promise<Friend[]> {
    const me = userId.toLowerCase();
    // A pair is stored once in normalized order, so the caller can be on
    // either side: match both columns and join in whichever id is *not* the
    // caller's.
    const rows = await this.getDb()
      .select(friendUserColumns)
      .from(friendship)
      .innerJoin(
        users,
        sql`${users.id} = CASE WHEN ${friendship.userAId} = ${me}::uuid THEN ${friendship.userBId} ELSE ${friendship.userAId} END`,
      )
      .where(or(eq(friendship.userAId, me), eq(friendship.userBId, me)));
    return rows.map(toFriend);
  }

  async findFriend(userId: string, otherUserId: string): Promise<Friend | null> {
    const { userAId, userBId } = normalizePair(userId, otherUserId);
    const [row] = await this.getDb()
      .select(friendUserColumns)
      .from(friendship)
      .innerJoin(users, eq(users.id, otherUserId.toLowerCase()))
      .where(and(eq(friendship.userAId, userAId), eq(friendship.userBId, userBId)))
      .limit(1);
    return row ? toFriend(row) : null;
  }

  async delete(userId: string, otherUserId: string): Promise<boolean> {
    const { userAId, userBId } = normalizePair(userId, otherUserId);
    const deleted = await this.getDb()
      .delete(friendship)
      .where(and(eq(friendship.userAId, userAId), eq(friendship.userBId, userBId)))
      .returning({ id: friendship.id });
    return deleted.length > 0;
  }
}
