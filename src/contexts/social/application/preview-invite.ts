import { InviteNotFound } from "../domain/errors";
import { isInviteUsable } from "../domain/friend-invite";
import type { FriendInviteRepository } from "../domain/friend-invite-repository";
import type { FriendshipRepository } from "../domain/friendship-repository";
import { hashInviteToken } from "../domain/invite-token";
import { reasonUnusable } from "./accept-invite";
import { toFriend } from "./friend-view";

export interface PreviewInviteRepositories {
  friendships: FriendshipRepository;
  invites: FriendInviteRepository;
}

export interface PreviewInviteInput {
  /** The signed-in viewer — preview requires login so tokens cannot be swept anonymously. */
  userId: string;
  token: string;
  now?: Date;
}

export interface PreviewInviteResult {
  /** Name only: the preview deliberately carries neither the inviter's email nor their user id. */
  inviterDisplayName: string;
  alreadyFriends: boolean;
}

/**
 * Use case: show who is behind an invite link before accepting it. Nothing is
 * recorded about the viewing — deliberately, so an inviter cannot learn who
 * opened a link without accepting (add-friends/design.md).
 */
export async function previewInvite(
  repositories: PreviewInviteRepositories,
  input: PreviewInviteInput,
): Promise<PreviewInviteResult> {
  const now = input.now ?? new Date();
  const found = await repositories.invites.findByTokenHash(await hashInviteToken(input.token));
  if (!found) throw new InviteNotFound();

  const inviter = toFriend(found.inviter);

  // Same ordering as accept: someone who is already a friend is told so rather
  // than shown "already used" for the link they themselves used.
  const existing = await repositories.friendships.findFriend(input.userId, found.invite.inviterUserId);
  if (existing) return { inviterDisplayName: inviter.displayName, alreadyFriends: true };

  if (!isInviteUsable(found.invite, now)) throw reasonUnusable(found.invite, now);
  return { inviterDisplayName: inviter.displayName, alreadyFriends: false };
}
