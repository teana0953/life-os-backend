import type { Friend } from "../domain/friend-user";
import type { FriendshipRepository } from "../domain/friendship-repository";
import { toFriend } from "./friend-view";

/** Use case: the user's friends, by name only. */
export async function listFriends(repository: FriendshipRepository, userId: string): Promise<Friend[]> {
  const records = await repository.listFriends(userId);
  return records.map(toFriend);
}
