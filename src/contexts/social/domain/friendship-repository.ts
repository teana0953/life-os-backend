import type { FriendUserRecord } from "./friend-user";

export interface FriendshipRepository {
  /**
   * Everyone `userId` is friends with. Because a pair is stored once in
   * normalized order, this must match **both** columns (`user_a_id = me OR
   * user_b_id = me`) and return the other side.
   */
  listFriends(userId: string): Promise<FriendUserRecord[]>;
  /** The other user's name record if the two are friends, else `null` (also serves as the "are we already friends?" check). */
  findFriend(userId: string, otherUserId: string): Promise<FriendUserRecord | null>;
  /** Removes the pair from either side. Returns whether a row was deleted. */
  delete(userId: string, otherUserId: string): Promise<boolean>;
}
