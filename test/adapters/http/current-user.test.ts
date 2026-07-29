import { describe, expect, it } from "vitest";
import { resolveAdminUser } from "../../../src/adapters/http/current-user";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import type { FirebaseClaims } from "../../../src/shared/auth/firebase-verifier";

class InMemoryUserRepository implements UserRepository {
  private usersByFirebaseUid = new Map<string, User>();
  private nextId = 1;

  constructor(private readonly isAdmin: boolean) {}

  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const existing = this.usersByFirebaseUid.get(input.firebaseUid);
    if (existing) return existing;
    const user: User = {
      id: `user-${this.nextId++}`,
      firebaseUid: input.firebaseUid,
      email: input.email,
      displayName: input.displayName,
      timezone: "Asia/Taipei",
      isAdmin: this.isAdmin,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    this.usersByFirebaseUid.set(input.firebaseUid, user);
    return user;
  }

  async updateTimezone(): Promise<void> {}

  async getById(userId: string): Promise<User | null> {
    for (const user of this.usersByFirebaseUid.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }

  get(firebaseUid: string): User | undefined {
    return this.usersByFirebaseUid.get(firebaseUid);
  }
}

const claims: FirebaseClaims = { uid: "uid-1", email: "alice@example.com", displayName: "Alice" };

describe("resolveAdminUser", () => {
  it("returns the user when isAdmin is true", async () => {
    const repo = new InMemoryUserRepository(true);

    const user = await resolveAdminUser(repo, claims);

    expect(user?.firebaseUid).toBe("uid-1");
  });

  it("returns null when isAdmin is false, but still get-or-creates the user record", async () => {
    const repo = new InMemoryUserRepository(false);

    const user = await resolveAdminUser(repo, claims);

    expect(user).toBeNull();
    expect(repo.get("uid-1")).toBeDefined();
  });
});
