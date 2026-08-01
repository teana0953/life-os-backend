import type { FriendInvite } from "../../../src/contexts/social/domain/friend-invite";
import { isInviteUsable } from "../../../src/contexts/social/domain/friend-invite";
import type {
  ClaimInviteInput,
  ClaimInviteResult,
  CreateFriendInviteInput,
  FriendInviteRepository,
  FriendInviteWithInviter,
} from "../../../src/contexts/social/domain/friend-invite-repository";
import type { FriendUserRecord } from "../../../src/contexts/social/domain/friend-user";
import { normalizePair } from "../../../src/contexts/social/domain/friendship";
import type { FriendshipRepository } from "../../../src/contexts/social/domain/friendship-repository";

/** The `users` columns the real adapters join in — nothing else exists here, mirroring the "no `select *`" rule. */
export class FakeUserDirectory {
  private records = new Map<string, FriendUserRecord>();

  add(userId: string, fields: { displayName?: string | null; email: string }): FriendUserRecord {
    const record: FriendUserRecord = { userId, displayName: fields.displayName ?? null, email: fields.email };
    this.records.set(userId, record);
    return record;
  }

  get(userId: string): FriendUserRecord {
    const record = this.records.get(userId);
    if (!record) throw new Error(`test fake: no user record for ${userId}`);
    return record;
  }
}

interface StoredFriendship {
  id: string;
  userAId: string;
  userBId: string;
  createdAt: Date;
}

export class InMemoryFriendshipRepository implements FriendshipRepository {
  rows: StoredFriendship[] = [];
  private nextId = 1;

  constructor(private readonly users: FakeUserDirectory) {}

  /** Mirrors the adapter's `ON CONFLICT DO NOTHING`: a pair can only be stored once, in normalized order. */
  insertIgnoringConflict(userId: string, otherUserId: string): void {
    const { userAId, userBId } = normalizePair(userId, otherUserId);
    if (this.rows.some((row) => row.userAId === userAId && row.userBId === userBId)) return;
    this.rows.push({ id: `friendship-${this.nextId++}`, userAId, userBId, createdAt: new Date() });
  }

  async listFriends(userId: string): Promise<FriendUserRecord[]> {
    const me = userId.toLowerCase();
    return this.rows
      .filter((row) => row.userAId === me || row.userBId === me)
      .map((row) => this.users.get(row.userAId === me ? row.userBId : row.userAId));
  }

  async findFriend(userId: string, otherUserId: string): Promise<FriendUserRecord | null> {
    const { userAId, userBId } = normalizePair(userId, otherUserId);
    const row = this.rows.find((r) => r.userAId === userAId && r.userBId === userBId);
    return row ? this.users.get(otherUserId.toLowerCase()) : null;
  }

  async delete(userId: string, otherUserId: string): Promise<boolean> {
    const { userAId, userBId } = normalizePair(userId, otherUserId);
    const index = this.rows.findIndex((r) => r.userAId === userAId && r.userBId === userBId);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }
}

interface StoredInvite {
  id: string;
  inviterUserId: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function toDomain(row: StoredInvite): FriendInvite {
  return {
    id: row.id,
    inviterUserId: row.inviterUserId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export class InMemoryFriendInviteRepository implements FriendInviteRepository {
  rows: StoredInvite[] = [];
  /** Clock the fake's `claimForAccept` uses, standing in for SQL `now()`. */
  now = new Date();
  /** Hook to interleave a competing accept, reproducing "pre-read was valid but the claim lost the race". */
  onBeforeClaim?: () => void | Promise<void>;
  private nextId = 1;

  constructor(
    private readonly users: FakeUserDirectory,
    private readonly friendships: InMemoryFriendshipRepository,
  ) {}

  async create(input: CreateFriendInviteInput): Promise<FriendInvite> {
    const row: StoredInvite = {
      id: `invite-${this.nextId++}`,
      inviterUserId: input.inviterUserId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      createdAt: this.now,
    };
    this.rows.push(row);
    return toDomain(row);
  }

  async findByTokenHash(tokenHash: string): Promise<FriendInviteWithInviter | null> {
    const row = this.rows.find((r) => r.tokenHash === tokenHash);
    if (!row) return null;
    return { invite: toDomain(row), inviter: this.users.get(row.inviterUserId) };
  }

  async listUsableByInviter(inviterUserId: string, now: Date): Promise<FriendInvite[]> {
    return this.rows
      .filter((r) => r.inviterUserId === inviterUserId)
      .map(toDomain)
      .filter((invite) => isInviteUsable(invite, now));
  }

  async revoke(inviterUserId: string, id: string, now: Date): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id && r.inviterUserId === inviterUserId && r.revokedAt === null && r.acceptedAt === null);
    if (!row) return false;
    row.revokedAt = now;
    return true;
  }

  /** Emulates the adapter's single CTE: claim-if-usable, and insert the pair only when the claim won. */
  async claimForAccept(input: ClaimInviteInput): Promise<ClaimInviteResult> {
    await this.onBeforeClaim?.();
    const row = this.rows.find((r) => r.tokenHash === input.tokenHash);
    if (!row || !isInviteUsable(toDomain(row), this.now)) return { claimed: false };
    row.acceptedAt = this.now;
    row.acceptedByUserId = input.acceptingUserId;
    this.friendships.insertIgnoringConflict(row.inviterUserId, input.acceptingUserId);
    return { claimed: true, inviterUserId: row.inviterUserId };
  }
}
