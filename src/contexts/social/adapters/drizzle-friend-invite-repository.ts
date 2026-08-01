import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { friendInvite, users } from "../../../shared/db/schema";
import type { FriendInvite } from "../domain/friend-invite";
import type {
  ClaimInviteInput,
  ClaimInviteResult,
  CreateFriendInviteInput,
  FriendInviteRepository,
  FriendInviteWithInviter,
} from "../domain/friend-invite-repository";

type FriendInviteRow = typeof friendInvite.$inferSelect;

/** Maps a row to the domain entity, dropping `token_hash` and `accepted_by_user_id` — neither belongs in a response. */
function toDomain(row: FriendInviteRow): FriendInvite {
  return {
    id: row.id,
    inviterUserId: row.inviterUserId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/** Driven adapter: implements FriendInviteRepository via Drizzle + Neon. */
export class DrizzleFriendInviteRepository implements FriendInviteRepository {
  constructor(private readonly getDb: () => Db) {}

  async create(input: CreateFriendInviteInput): Promise<FriendInvite> {
    const [row] = await this.getDb()
      .insert(friendInvite)
      .values({ inviterUserId: input.inviterUserId, tokenHash: input.tokenHash, expiresAt: input.expiresAt })
      .returning();
    if (!row) throw new Error("failed to create friend invite");
    return toDomain(row);
  }

  async findByTokenHash(tokenHash: string): Promise<FriendInviteWithInviter | null> {
    // Only the inviter columns a display name can be derived from — never the
    // whole user row (add-friends/design.md "資訊揭露原則").
    const [row] = await this.getDb()
      .select({
        invite: friendInvite,
        inviterDisplayName: users.displayName,
        inviterEmail: users.email,
      })
      .from(friendInvite)
      .innerJoin(users, eq(users.id, friendInvite.inviterUserId))
      .where(eq(friendInvite.tokenHash, tokenHash))
      .limit(1);
    if (!row) return null;
    return {
      invite: toDomain(row.invite),
      inviter: { userId: row.invite.inviterUserId, displayName: row.inviterDisplayName, email: row.inviterEmail },
    };
  }

  async listUsableByInviter(inviterUserId: string, now: Date): Promise<FriendInvite[]> {
    const rows = await this.getDb()
      .select()
      .from(friendInvite)
      .where(
        and(
          eq(friendInvite.inviterUserId, inviterUserId),
          isNull(friendInvite.acceptedAt),
          isNull(friendInvite.revokedAt),
          gt(friendInvite.expiresAt, now),
        ),
      )
      .orderBy(friendInvite.createdAt);
    return rows.map(toDomain);
  }

  async revoke(inviterUserId: string, id: string, now: Date): Promise<boolean> {
    const revoked = await this.getDb()
      .update(friendInvite)
      .set({ revokedAt: now })
      .where(
        and(
          eq(friendInvite.id, id),
          eq(friendInvite.inviterUserId, inviterUserId),
          isNull(friendInvite.acceptedAt),
          isNull(friendInvite.revokedAt),
        ),
      )
      .returning({ id: friendInvite.id });
    return revoked.length > 0;
  }

  /**
   * Consumes the invite and creates the friendship in **one** statement.
   *
   * There is no alternative here: `drizzle-orm/neon-http` has no transaction
   * support (its session throws outright), and `db.batch` cannot branch on a
   * read. Split into a conditional UPDATE plus a separate INSERT, a failed
   * insert would leave the invite consumed with nothing to roll back — the
   * exact "an invite is never consumed without its friendship" guarantee the
   * spec makes. So the whole claim is a single data-modifying CTE:
   *
   * - `claimed` consumes the invite only if it is unaccepted, unrevoked and
   *   unexpired; the UPDATE's own row lock is what makes two simultaneous
   *   accepts resolve to exactly one winner.
   * - `inserted` writes the pair in normalized order (`LEAST`/`GREATEST` on
   *   uuid gives the same ordering as the table's CHECK). Being a
   *   data-modifying CTE it always runs to completion even though the final
   *   SELECT does not reference it. `ON CONFLICT (user_a_id, user_b_id) DO
   *   NOTHING` covers the race where the pair was created by another path in
   *   between — the claim still counts as won, because the friendship exists
   *   either way. The conflict target is named on purpose: a bare `ON CONFLICT
   *   DO NOTHING` swallows *any* future unique violation on `friendship`, which
   *   would consume the invite while silently creating no friendship — exactly
   *   the guarantee this statement exists to keep. Naming the pair means only
   *   the already-friends race is absorbed; anything else still errors, and the
   *   claim's UPDATE is rolled back with it.
   * - The final SELECT reads `claimed`, so a row comes back exactly when the
   *   claim won, whether or not the insert added anything.
   */
  async claimForAccept(input: ClaimInviteInput): Promise<ClaimInviteResult> {
    const result = await this.getDb().execute<{ inviter_user_id: string }>(sql`
      WITH claimed AS (
        UPDATE friend_invite
           SET accepted_at = now(), accepted_by_user_id = ${input.acceptingUserId}::uuid
         WHERE token_hash = ${input.tokenHash}
           AND accepted_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > now()
        RETURNING inviter_user_id
      ), inserted AS (
        INSERT INTO friendship (user_a_id, user_b_id)
        SELECT LEAST(inviter_user_id, ${input.acceptingUserId}::uuid),
               GREATEST(inviter_user_id, ${input.acceptingUserId}::uuid)
          FROM claimed
        ON CONFLICT (user_a_id, user_b_id) DO NOTHING
        RETURNING id
      )
      SELECT inviter_user_id FROM claimed
    `);
    const row = result.rows[0];
    return row ? { claimed: true, inviterUserId: row.inviter_user_id } : { claimed: false };
  }
}
