import { eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { users } from "../../../shared/db/schema";
import type { User } from "../domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../domain/user-repository";

type UserRow = typeof users.$inferSelect;

function toDomain(row: UserRow): User {
  return {
    id: row.id,
    firebaseUid: row.firebaseUid,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
  };
}

/**
 * Driven adapter: implements UserRepository via Drizzle + Neon.
 * Get-or-create by firebase_uid; a returning user's stored email/displayName
 * are not refreshed from the input.
 */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, input.firebaseUid))
      .limit(1);
    if (existing) return toDomain(existing);

    const [created] = await this.db
      .insert(users)
      .values({
        firebaseUid: input.firebaseUid,
        email: input.email,
        displayName: input.displayName,
      })
      .onConflictDoNothing({ target: users.firebaseUid })
      .returning();
    if (created) return toDomain(created);

    // Lost a race with a concurrent insert for the same firebase_uid.
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, input.firebaseUid))
      .limit(1);
    if (!row) throw new Error("failed to get or create user");
    return toDomain(row);
  }
}
