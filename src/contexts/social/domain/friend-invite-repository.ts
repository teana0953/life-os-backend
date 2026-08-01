import type { FriendInvite } from "./friend-invite";
import type { Friend } from "./friend-user";

export interface CreateFriendInviteInput {
  inviterUserId: string;
  tokenHash: string;
  expiresAt: Date;
}

/** An invite plus its inviter — one join, and the name is already resolved so no address crosses the port. */
export interface FriendInviteWithInviter {
  invite: FriendInvite;
  inviter: Friend;
}

export interface ClaimInviteInput {
  tokenHash: string;
  acceptingUserId: string;
}

/**
 * Outcome of the atomic claim. `claimed: false` means the invite was not
 * usable at claim time; the caller tells the four reasons apart from the
 * invite it already read, without a second query. A claim that won but whose
 * friendship insert hit `ON CONFLICT DO NOTHING` still reports `claimed:
 * true` — the pair exists either way, which is all the caller needs.
 */
export type ClaimInviteResult = { claimed: false } | { claimed: true; inviterUserId: string };

export interface FriendInviteRepository {
  create(input: CreateFriendInviteInput): Promise<FriendInvite>;
  /** Lookup by the deterministic token hash; also returns the inviter for preview/accept. */
  findByTokenHash(tokenHash: string): Promise<FriendInviteWithInviter | null>;
  /** The inviter's own still-usable invites (not accepted, not revoked, not expired). */
  listUsableByInviter(inviterUserId: string, now: Date): Promise<FriendInvite[]>;
  /** Owner-scoped revoke; another user's invite must be indistinguishable from a missing one, so this returns `false`. */
  revoke(inviterUserId: string, id: string, now: Date): Promise<boolean>;
  /**
   * Consumes the invite and creates the friendship in **one** statement.
   *
   * This must stay atomic: the neon-http driver has no transactions, so a
   * two-step "conditional update, then insert" would consume an invite with
   * no way to roll back if the insert failed. See the Drizzle adapter for the
   * data-modifying CTE that implements it.
   */
  claimForAccept(input: ClaimInviteInput): Promise<ClaimInviteResult>;
}
