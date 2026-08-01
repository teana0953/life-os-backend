import { InviteNotFound } from "../domain/errors";
import type { FriendInviteRepository } from "../domain/friend-invite-repository";

/**
 * Use case: revoke one of the caller's own invites. Another user's invite is
 * reported as not found, so it stays indistinguishable from one that never
 * existed.
 */
export async function revokeInvite(
  repository: FriendInviteRepository,
  inviterUserId: string,
  inviteId: string,
  now: Date = new Date(),
): Promise<void> {
  const revoked = await repository.revoke(inviterUserId, inviteId, now);
  if (!revoked) throw new InviteNotFound();
}
