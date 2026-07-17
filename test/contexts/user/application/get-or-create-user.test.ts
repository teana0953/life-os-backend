import { describe, expect, it } from "vitest";
import { getOrCreateUser } from "../../../../src/contexts/user/application/get-or-create-user";
import type { User } from "../../../../src/contexts/user/domain/user";
import type { UserRepository } from "../../../../src/contexts/user/domain/user-repository";

class InMemoryUserRepository implements UserRepository {
  private usersByFirebaseUid = new Map<string, User>();
  private nextId = 1;

  async getOrCreate(input: {
    firebaseUid: string;
    email: string;
    displayName: string | null;
  }): Promise<User> {
    const existing = this.usersByFirebaseUid.get(input.firebaseUid);
    if (existing) return existing;

    const user: User = {
      id: String(this.nextId++),
      firebaseUid: input.firebaseUid,
      email: input.email,
      displayName: input.displayName,
      createdAt: new Date(),
    };
    this.usersByFirebaseUid.set(input.firebaseUid, user);
    return user;
  }
}

describe("getOrCreateUser", () => {
  it("creates a new user record on first authenticated request", async () => {
    const repo = new InMemoryUserRepository();

    const user = await getOrCreateUser(repo, {
      firebaseUid: "uid-1",
      email: "alice@example.com",
      displayName: "Alice",
    });

    expect(user.firebaseUid).toBe("uid-1");
    expect(user.email).toBe("alice@example.com");
    expect(user.displayName).toBe("Alice");
    expect(user.id).toBeTruthy();
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it("reuses the existing row for a returning user without refreshing stored fields", async () => {
    const repo = new InMemoryUserRepository();
    const first = await getOrCreateUser(repo, {
      firebaseUid: "uid-1",
      email: "alice@example.com",
      displayName: "Alice",
    });

    const second = await getOrCreateUser(repo, {
      firebaseUid: "uid-1",
      email: "new-email@example.com",
      displayName: "New Name",
    });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe("alice@example.com");
    expect(second.displayName).toBe("Alice");
  });
});
