import type { FriendshipRepository } from "../domain/friendship-repository";

/**
 * Use case: end a friendship from either side. Returns whether a pair was
 * removed — "not your friend" and "no such user" are the same `false`, which
 * the route turns into one 404 so neither reveals whether the other exists.
 */
export async function removeFriend(
  repository: FriendshipRepository,
  userId: string,
  friendUserId: string,
): Promise<boolean> {
  return repository.delete(userId, friendUserId);
}
