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
    timezone: row.timezone,
    createdAt: row.createdAt,
  };
}

/**
 * Driven adapter: implements UserRepository via Drizzle + Neon.
 * Get-or-create by firebase_uid; a returning user's stored email/displayName
 * are not refreshed from the input.
 *
 * Takes a lazy `() => Db` factory rather than an eager Db so that constructing
 * the Neon client (which throws on a malformed DATABASE_URL) happens on first
 * use — inside the HTTP error boundary — instead of crashing the Worker.
 */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly getDb: () => Db) {}

  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const db = this.getDb();

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, input.firebaseUid))
      .limit(1);
    if (existing) return toDomain(existing);

    const [created] = await db
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
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, input.firebaseUid))
      .limit(1);
    if (!row) throw new Error("failed to get or create user");
    return toDomain(row);
  }

  async updateTimezone(userId: string, timezone: string): Promise<void> {
    const db = this.getDb();
    await db.update(users).set({ timezone }).where(eq(users.id, userId));
  }

  async getById(userId: string): Promise<User | null> {
    const db = this.getDb();
    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ? toDomain(row) : null;
  }
}
