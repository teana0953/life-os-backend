import type { FriendInvite } from "../domain/friend-invite";
import type { FriendInviteRepository } from "../domain/friend-invite-repository";

export async function listMyInvites(
  repository: FriendInviteRepository,
  inviterUserId: string,
  now: Date = new Date(),
): Promise<FriendInvite[]> {
  return repository.listUsableByInviter(inviterUserId, now);
}
