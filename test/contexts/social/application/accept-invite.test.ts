import { beforeEach, describe, expect, it } from "vitest";
import { acceptInvite } from "../../../../src/contexts/social/application/accept-invite";
import { createInvite } from "../../../../src/contexts/social/application/create-invite";
import { listFriends } from "../../../../src/contexts/social/application/list-friends";
import {
  CannotFriendSelf,
  InviteAlreadyUsed,
  InviteExpired,
  InviteNotFound,
  InviteRevoked,
} from "../../../../src/contexts/social/domain/errors";
import { FakeUserDirectory, InMemoryFriendInviteRepository, InMemoryFriendshipRepository } from "../fakes";

const NOW = new Date("2026-08-01T00:00:00.000Z");

let users: FakeUserDirectory;
let friendships: InMemoryFriendshipRepository;
let invites: InMemoryFriendInviteRepository;

beforeEach(() => {
  users = new FakeUserDirectory();
  users.add("user-a", { email: "alice@example.com", displayName: "Alice" });
  users.add("user-b", { email: "bob@example.com", displayName: "Bob" });
  users.add("user-c", { email: "carol@example.com", displayName: "Carol" });
  friendships = new InMemoryFriendshipRepository(users);
  invites = new InMemoryFriendInviteRepository(users, friendships);
  invites.now = NOW;
});

async function inviteFrom(inviterUserId: string): Promise<string> {
  const { token } = await createInvite(invites, inviterUserId, NOW);
  return token;
}

describe("acceptInvite", () => {
  it("creates exactly one friendship, visible from both sides", async () => {
    const result = await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token: await inviteFrom("user-a"), now: NOW });

    expect(result).toEqual({ friend: { userId: "user-a", displayName: "Alice" }, alreadyFriends: false });
    expect(friendships.rows).toHaveLength(1);
    expect(await listFriends(friendships, "user-a")).toEqual([{ userId: "user-b", displayName: "Bob" }]);
    expect(await listFriends(friendships, "user-b")).toEqual([{ userId: "user-a", displayName: "Alice" }]);
  });

  it("consumes the invite, so the same link cannot be used by someone else", async () => {
    const token = await inviteFrom("user-a");
    await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token, now: NOW });

    await expect(
      acceptInvite({ friendships, invites }, { acceptingUserId: "user-c", token, now: NOW }),
    ).rejects.toBeInstanceOf(InviteAlreadyUsed);
    // The first friendship is untouched.
    expect(friendships.rows).toHaveLength(1);
    expect(await listFriends(friendships, "user-c")).toEqual([]);
  });

  it("is idempotent for someone who is already a friend, without consuming a second invite", async () => {
    await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token: await inviteFrom("user-a"), now: NOW });
    const secondToken = await inviteFrom("user-a");

    const result = await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token: secondToken, now: NOW });

    expect(result).toEqual({ friend: { userId: "user-a", displayName: "Alice" }, alreadyFriends: true });
    expect(friendships.rows).toHaveLength(1);
    // The second invite was never claimed.
    expect(invites.rows[1].acceptedAt).toBeNull();
  });

  it("does not create a second friendship when the reverse direction is invited and accepted", async () => {
    await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token: await inviteFrom("user-a"), now: NOW });
    await acceptInvite({ friendships, invites }, { acceptingUserId: "user-a", token: await inviteFrom("user-b"), now: NOW });

    expect(friendships.rows).toHaveLength(1);
  });

  it("rejects accepting your own invite, and creates nothing", async () => {
    const token = await inviteFrom("user-a");
    await expect(
      acceptInvite({ friendships, invites }, { acceptingUserId: "user-a", token, now: NOW }),
    ).rejects.toBeInstanceOf(CannotFriendSelf);

    expect(friendships.rows).toHaveLength(0);
    expect(invites.rows[0].acceptedAt).toBeNull();
  });

  it("reports an unknown token as not found, never as another failure", async () => {
    await expect(
      acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token: "no-such-token", now: NOW }),
    ).rejects.toBeInstanceOf(InviteNotFound);
  });

  it("tells expiry apart from the other failures", async () => {
    const token = await inviteFrom("user-a");
    const later = new Date("2026-08-09T00:00:00.000Z");
    invites.now = later;

    await expect(
      acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token, now: later }),
    ).rejects.toBeInstanceOf(InviteExpired);
    expect(friendships.rows).toHaveLength(0);
  });

  it("tells revocation apart from the other failures", async () => {
    const token = await inviteFrom("user-a");
    await invites.revoke("user-a", invites.rows[0].id, NOW);

    await expect(
      acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token, now: NOW }),
    ).rejects.toBeInstanceOf(InviteRevoked);
    expect(friendships.rows).toHaveLength(0);
  });

  it("loses the race to a concurrent accept: exactly one friendship, the other told it is already used", async () => {
    const token = await inviteFrom("user-a");
    // The invite is still usable when user-c pre-reads it; user-b claims it in
    // between, so user-c's claim comes back empty.
    invites.onBeforeClaim = async () => {
      invites.onBeforeClaim = undefined;
      await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token, now: NOW });
    };

    await expect(
      acceptInvite({ friendships, invites }, { acceptingUserId: "user-c", token, now: NOW }),
    ).rejects.toBeInstanceOf(InviteAlreadyUsed);

    expect(friendships.rows).toHaveLength(1);
    expect(invites.rows[0].acceptedByUserId).toBe("user-b");
  });

  it("treats a claim whose insert hit ON CONFLICT DO NOTHING as success", async () => {
    const token = await inviteFrom("user-a");
    // The pair appears between the already-friends pre-check and the claim.
    invites.onBeforeClaim = () => {
      invites.onBeforeClaim = undefined;
      friendships.insertIgnoringConflict("user-a", "user-b");
    };

    const result = await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token, now: NOW });

    expect(result).toEqual({ friend: { userId: "user-a", displayName: "Alice" }, alreadyFriends: false });
    expect(friendships.rows).toHaveLength(1);
  });

  it("never returns an email address", async () => {
    users.add("user-d", { email: "dave@example.com", displayName: null });
    const { token } = await createInvite(invites, "user-d", NOW);

    const result = await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token, now: NOW });

    expect(result.friend.displayName).toBe("dave");
    expect(JSON.stringify(result)).not.toContain("@");
  });
});
