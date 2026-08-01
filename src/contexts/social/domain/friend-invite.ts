/**
 * An invite as the application sees it. It deliberately carries neither the
 * plaintext token (which exists only in the creating response) nor the token
 * hash, so neither can reach a response payload by accident.
 */
export interface FriendInvite {
  id: string;
  inviterUserId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Whether an invite is still usable at `now` — the same three conditions the accept CTE tests in SQL. */
export function isInviteUsable(invite: FriendInvite, now: Date): boolean {
  return invite.acceptedAt === null && invite.revokedAt === null && invite.expiresAt.getTime() > now.getTime();
}
