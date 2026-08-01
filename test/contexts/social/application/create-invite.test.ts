import { beforeEach, describe, expect, it } from "vitest";
import { createInvite } from "../../../../src/contexts/social/application/create-invite";
import { hashInviteToken } from "../../../../src/contexts/social/domain/invite-token";
import { FakeUserDirectory, InMemoryFriendInviteRepository, InMemoryFriendshipRepository } from "../fakes";

const NOW = new Date("2026-08-01T00:00:00.000Z");

let users: FakeUserDirectory;
let invites: InMemoryFriendInviteRepository;

beforeEach(() => {
  users = new FakeUserDirectory();
  users.add("user-a", { email: "alice@example.com", displayName: "Alice" });
  invites = new InMemoryFriendInviteRepository(users, new InMemoryFriendshipRepository(users));
});

describe("createInvite", () => {
  it("returns the plaintext token once and stores only its hash", async () => {
    const { token } = await createInvite(invites, "user-a", NOW);

    expect(token).not.toBe("");
    const [stored] = invites.rows;
    expect(stored.tokenHash).toBe(await hashInviteToken(token));
    // The plaintext must not survive anywhere in the stored row.
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("hashes deterministically, without a salt, so a lookup by hash can find the row", async () => {
    const { token } = await createInvite(invites, "user-a", NOW);
    expect(await hashInviteToken(token)).toBe(await hashInviteToken(token));

    const found = await invites.findByTokenHash(await hashInviteToken(token));
    expect(found?.invite.inviterUserId).toBe("user-a");
  });

  it("mints a distinct, high-entropy token per invite", async () => {
    const first = await createInvite(invites, "user-a", NOW);
    const second = await createInvite(invites, "user-a", NOW);

    expect(first.token).not.toBe(second.token);
    // 32 random bytes as unpadded base64url.
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("expires seven days after creation", async () => {
    const { invite } = await createInvite(invites, "user-a", NOW);
    expect(invite.expiresAt.toISOString()).toBe("2026-08-08T00:00:00.000Z");
    expect(invite.acceptedAt).toBeNull();
    expect(invite.revokedAt).toBeNull();
  });
});
