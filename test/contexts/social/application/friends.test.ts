import { beforeEach, describe, expect, it } from "vitest";
import { acceptInvite } from "../../../../src/contexts/social/application/accept-invite";
import { createInvite } from "../../../../src/contexts/social/application/create-invite";
import { listFriends } from "../../../../src/contexts/social/application/list-friends";
import { listMyInvites } from "../../../../src/contexts/social/application/list-my-invites";
import { previewInvite } from "../../../../src/contexts/social/application/preview-invite";
import { removeFriend } from "../../../../src/contexts/social/application/remove-friend";
import { revokeInvite } from "../../../../src/contexts/social/application/revoke-invite";
import {
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
  users.add("user-b", { email: "bob@example.com", displayName: null });
  users.add("user-c", { email: "carol@example.com", displayName: "Carol" });
  friendships = new InMemoryFriendshipRepository(users);
  invites = new InMemoryFriendInviteRepository(users, friendships);
  invites.now = NOW;
});

describe("listFriends", () => {
  it("falls back to the email's local part when a friend has no display name, and exposes no address", async () => {
    friendships.insertIgnoringConflict("user-a", "user-b");

    const friends = await listFriends(friendships, "user-a");

    expect(friends).toEqual([{ userId: "user-b", displayName: "bob" }]);
    expect(JSON.stringify(friends)).not.toContain("@");
  });

  it("matches both stored columns, whichever side the caller is on", async () => {
    // Normalization puts user-a first, so user-c is found through user_b_id.
    friendships.insertIgnoringConflict("user-c", "user-a");

    expect(await listFriends(friendships, "user-a")).toEqual([{ userId: "user-c", displayName: "Carol" }]);
    expect(await listFriends(friendships, "user-c")).toEqual([{ userId: "user-a", displayName: "Alice" }]);
  });
});

describe("removeFriend", () => {
  it("removes the pair for both sides, from either side", async () => {
    friendships.insertIgnoringConflict("user-a", "user-b");

    expect(await removeFriend(friendships, "user-b", "user-a")).toBe(true);
    expect(await listFriends(friendships, "user-a")).toEqual([]);
    expect(await listFriends(friendships, "user-b")).toEqual([]);
  });

  it("reports a non-friend and an unknown user the same way", async () => {
    expect(await removeFriend(friendships, "user-a", "user-c")).toBe(false);
    expect(await removeFriend(friendships, "user-a", "user-nobody")).toBe(false);
  });
});

describe("listMyInvites", () => {
  it("lists only the caller's own still-usable invites", async () => {
    const mine = await createInvite(invites, "user-a", NOW);
    await createInvite(invites, "user-c", NOW);

    const listed = await listMyInvites(invites, "user-a", NOW);

    expect(listed.map((invite) => invite.id)).toEqual([mine.invite.id]);
  });

  it("hides accepted, revoked and expired invites", async () => {
    const accepted = await createInvite(invites, "user-a", NOW);
    await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token: accepted.token, now: NOW });
    const revoked = await createInvite(invites, "user-a", NOW);
    await revokeInvite(invites, "user-a", revoked.invite.id, NOW);
    await createInvite(invites, "user-a", NOW);

    const later = new Date("2026-08-09T00:00:00.000Z");
    expect(await listMyInvites(invites, "user-a", later)).toEqual([]);
  });
});

describe("revokeInvite", () => {
  it("refuses to revoke another user's invite, indistinguishably from a missing one", async () => {
    const { invite } = await createInvite(invites, "user-a", NOW);

    await expect(revokeInvite(invites, "user-c", invite.id, NOW)).rejects.toBeInstanceOf(InviteNotFound);
    await expect(revokeInvite(invites, "user-c", "no-such-invite", NOW)).rejects.toBeInstanceOf(InviteNotFound);
    expect(invites.rows[0].revokedAt).toBeNull();
  });

  it("makes the invite unusable once revoked", async () => {
    const { token, invite } = await createInvite(invites, "user-a", NOW);
    await revokeInvite(invites, "user-a", invite.id, NOW);

    await expect(
      acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token, now: NOW }),
    ).rejects.toBeInstanceOf(InviteRevoked);
  });
});

describe("previewInvite", () => {
  it("names the inviter without exposing an email or a user id", async () => {
    const { token } = await createInvite(invites, "user-b", NOW);

    const preview = await previewInvite({ friendships, invites }, { userId: "user-a", token, now: NOW });

    expect(preview).toEqual({ inviterDisplayName: "bob", alreadyFriends: false });
    expect(JSON.stringify(preview)).not.toContain("@");
    expect(JSON.stringify(preview)).not.toContain("user-b");
  });

  it("tells an already-friends viewer so, instead of erroring on a used invite", async () => {
    const { token } = await createInvite(invites, "user-a", NOW);
    await acceptInvite({ friendships, invites }, { acceptingUserId: "user-c", token, now: NOW });

    const preview = await previewInvite({ friendships, invites }, { userId: "user-c", token, now: NOW });

    expect(preview).toEqual({ inviterDisplayName: "Alice", alreadyFriends: true });
  });

  it("reports unknown, expired and used tokens distinctly", async () => {
    const { token } = await createInvite(invites, "user-a", NOW);

    await expect(
      previewInvite({ friendships, invites }, { userId: "user-b", token: "no-such-token", now: NOW }),
    ).rejects.toBeInstanceOf(InviteNotFound);

    const later = new Date("2026-08-09T00:00:00.000Z");
    await expect(previewInvite({ friendships, invites }, { userId: "user-b", token, now: later })).rejects.toBeInstanceOf(
      InviteExpired,
    );

    await acceptInvite({ friendships, invites }, { acceptingUserId: "user-b", token, now: NOW });
    await expect(previewInvite({ friendships, invites }, { userId: "user-c", token, now: NOW })).rejects.toBeInstanceOf(
      InviteAlreadyUsed,
    );
  });
});
