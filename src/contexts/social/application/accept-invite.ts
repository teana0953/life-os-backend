import { CannotFriendSelf, InviteAlreadyUsed, InviteExpired, InviteNotFound, InviteRevoked } from "../domain/errors";
import type { FriendInvite } from "../domain/friend-invite";
import type { FriendInviteRepository } from "../domain/friend-invite-repository";
import type { Friend } from "../domain/friend-user";
import type { FriendshipRepository } from "../domain/friendship-repository";
import { hashInviteToken } from "../domain/invite-token";
import { toFriend } from "./friend-view";

export interface AcceptInviteRepositories {
  friendships: FriendshipRepository;
  invites: FriendInviteRepository;
}

export interface AcceptInviteInput {
  acceptingUserId: string;
  token: string;
  now?: Date;
}

export interface AcceptInviteResult {
  friend: Friend;
  /** True when the pair already existed and no invite was consumed (re-opening a link you already used). */
  alreadyFriends: boolean;
}

/**
 * Use case: accept an invite.
 *
 * Order is load-bearing (add-friends/design.md "先後順序"):
 *  1. pre-read the invite by token hash — needed to know who the inviter is;
 *  2. already friends → return the existing relationship **without running the
 *     claim**, so re-opening a link never burns a second invite;
 *  3. inviting yourself → refuse;
 *  4. claim, which consumes the invite and creates the friendship in one
 *     statement (no transactions exist on this driver).
 *
 * When the claim comes back empty, the reason is read off the invite from step
 * 1 rather than re-queried. An invite that looked usable then but claims empty
 * now means a concurrent accept won the race — reported as already used.
 */
export async function acceptInvite(
  repositories: AcceptInviteRepositories,
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  const now = input.now ?? new Date();
  const tokenHash = await hashInviteToken(input.token);

  const found = await repositories.invites.findByTokenHash(tokenHash);
  if (!found) throw new InviteNotFound();
  const inviterUserId = found.invite.inviterUserId;

  const existing = await repositories.friendships.findFriend(input.acceptingUserId, inviterUserId);
  if (existing) return { friend: toFriend(existing), alreadyFriends: true };

  if (inviterUserId.toLowerCase() === input.acceptingUserId.toLowerCase()) throw new CannotFriendSelf();

  const claim = await repositories.invites.claimForAccept({ tokenHash, acceptingUserId: input.acceptingUserId });
  if (!claim.claimed) throw reasonUnusable(found.invite, now);

  // The claim won, so the pair exists — either inserted by it, or already
  // there because a concurrent path created it and the insert's `ON CONFLICT`
  // skipped it. Both are success, and the new friend is the inviter already
  // read in step 1, so there is nothing left to query.
  return { friend: toFriend(found.inviter), alreadyFriends: false };
}

/** Why an invite could not be claimed, decided from the pre-read row — no second query. */
export function reasonUnusable(invite: FriendInvite, now: Date): Error {
  if (invite.revokedAt !== null) return new InviteRevoked();
  if (invite.acceptedAt !== null) return new InviteAlreadyUsed();
  if (invite.expiresAt.getTime() <= now.getTime()) return new InviteExpired();
  return new InviteAlreadyUsed();
}
