import { eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { bodyProfile } from "../../../shared/db/schema";
import type { BodyProfile } from "../domain/body-profile";
import type { BodyProfileRepository, UpdateBodyProfilePatch } from "../domain/body-profile-repository";

type BodyProfileRow = typeof bodyProfile.$inferSelect;

function toDomain(row: BodyProfileRow): BodyProfile {
  return {
    userId: row.userId,
    heightCm: row.heightCm == null ? null : Number(row.heightCm),
    targetWeightKg: row.targetWeightKg == null ? null : Number(row.targetWeightKg),
  };
}

export class DrizzleBodyProfileRepository implements BodyProfileRepository {
  constructor(private readonly getDb: () => Db) {}

  async get(userId: string): Promise<BodyProfile | null> {
    const db = this.getDb();
    const [row] = await db.select().from(bodyProfile).where(eq(bodyProfile.userId, userId)).limit(1);
    return row ? toDomain(row) : null;
  }

  async upsert(userId: string, patch: UpdateBodyProfilePatch): Promise<BodyProfile> {
    // Build the update set from ONLY the patch's present fields (numerics stored
    // as strings, per Drizzle numeric).
    const set: Partial<typeof bodyProfile.$inferInsert> = {};
    if (patch.heightCm !== undefined) set.heightCm = String(patch.heightCm);
    if (patch.targetWeightKg !== undefined) set.targetWeightKg = String(patch.targetWeightKg);

    // Empty patch → no-op: return the current row (or default), never insert an
    // empty row and never issue a Drizzle `.set({})`.
    if (Object.keys(set).length === 0) {
      return (await this.get(userId)) ?? { userId, heightCm: null, targetWeightKg: null };
    }

    set.updatedAt = new Date();
    const db = this.getDb();
    const [row] = await db
      .insert(bodyProfile)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: bodyProfile.userId, set })
      .returning();
    if (!row) throw new Error("failed to upsert body profile");
    return toDomain(row);
  }
}
