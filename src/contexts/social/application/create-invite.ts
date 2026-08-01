import type { FriendInvite } from "../domain/friend-invite";
import type { FriendInviteRepository } from "../domain/friend-invite-repository";
import { generateInviteToken, hashInviteToken } from "../domain/invite-token";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreateInviteResult {
  /** The plaintext token, returned **once** so the caller can build a link; only its hash is stored. */
  token: string;
  invite: FriendInvite;
}

/** Use case: mint a single-use invite that expires in seven days. */
export async function createInvite(
  repository: FriendInviteRepository,
  inviterUserId: string,
  now: Date = new Date(),
): Promise<CreateInviteResult> {
  const token = generateInviteToken();
  const invite = await repository.create({
    inviterUserId,
    tokenHash: await hashInviteToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  });
  return { token, invite };
}
