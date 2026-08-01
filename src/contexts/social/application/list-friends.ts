import type { Friend } from "../domain/friend-user";
import type { FriendshipRepository } from "../domain/friendship-repository";

/** Use case: the user's friends, by name only. */
export async function listFriends(repository: FriendshipRepository, userId: string): Promise<Friend[]> {
  return repository.listFriends(userId);
}
