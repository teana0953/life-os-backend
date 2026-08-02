/**
 * Split's own port onto social's friendship data (design.md: "跨 context 的
 * 好友查詢"). Batched deliberately — an expense can have n share holders, and
 * `FriendshipRepository.findFriend` one at a time would be n round trips on
 * the neon-http driver.
 */
export interface FriendChecker {
  friendsAmong(userId: string, otherUserIds: string[]): Promise<Set<string>>;
}
