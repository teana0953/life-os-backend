import { and, eq, or } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { friendship } from "../../../shared/db/schema";
import { normalizePair } from "../../social/domain/friendship";
import type { FriendChecker } from "../domain/friend-checker";

/**
 * Driven adapter: implements split's own `FriendChecker` port by reading
 * social's `friendship` table directly. Reaching into another context's
 * schema and domain helper (`normalizePair`) is the one legitimate seam
 * design.md draws for the cross-context "must be a friend" rule — the port
 * itself is what keeps `split/domain` from depending on social at all.
 *
 * One query for the whole batch of `otherUserIds` (design.md: never one
 * round trip per participant on neon-http). Each candidate is normalized to
 * the same `(user_a_id, user_b_id)` order the table stores pairs in, so a
 * caller on either side of the stored row still matches.
 */
export class DrizzleFriendChecker implements FriendChecker {
  constructor(private readonly getDb: () => Db) {}

  async friendsAmong(userId: string, otherUserIds: string[]): Promise<Set<string>> {
    if (otherUserIds.length === 0) return new Set();
    const me = userId.toLowerCase();
    const pairs = otherUserIds.map((other) => normalizePair(me, other));

    const rows = await this.getDb()
      .select({ userAId: friendship.userAId, userBId: friendship.userBId })
      .from(friendship)
      .where(or(...pairs.map((pair) => and(eq(friendship.userAId, pair.userAId), eq(friendship.userBId, pair.userBId)))));

    const friends = new Set<string>();
    for (const row of rows) {
      friends.add(row.userAId === me ? row.userBId : row.userAId);
    }
    return friends;
  }
}
