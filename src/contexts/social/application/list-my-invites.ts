import type { FriendInvite } from "../domain/friend-invite";
import type { FriendInviteRepository } from "../domain/friend-invite-repository";

/** Use case: the caller's own invites that are still usable — never anyone else's. */
export async function listMyInvites(
  repository: FriendInviteRepository,
  inviterUserId: string,
  now: Date = new Date(),
): Promise<FriendInvite[]> {
  return repository.listUsableByInviter(inviterUserId, now);
}
