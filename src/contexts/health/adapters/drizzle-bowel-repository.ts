import { and, eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { bowelLog } from "../../../shared/db/schema";
import type { BowelLog } from "../domain/bowel";
import type { SetBowelLogInput, BowelRepository } from "../domain/bowel-repository";

type BowelLogRow = typeof bowelLog.$inferSelect;

function toDomain(row: BowelLogRow): BowelLog {
  return { userId: row.userId, day: row.day, count: row.count, isNormal: row.isNormal, note: row.note };
}

/** Driven adapter: implements BowelRepository via Drizzle + Neon. */
export class DrizzleBowelRepository implements BowelRepository {
  constructor(private readonly getDb: () => Db) {}

  async get(userId: string, day: string): Promise<BowelLog | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(bowelLog)
      .where(and(eq(bowelLog.userId, userId), eq(bowelLog.day, day)))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async set(input: SetBowelLogInput): Promise<BowelLog> {
    const db = this.getDb();
    const values = {
      userId: input.userId,
      day: input.day,
      count: input.count,
      isNormal: input.isNormal,
      note: input.note,
    };
    const [row] = await db
      .insert(bowelLog)
      .values(values)
      .onConflictDoUpdate({ target: [bowelLog.userId, bowelLog.day], set: values })
      .returning();
    if (!row) throw new Error("failed to set bowel log");
    return toDomain(row);
  }
}
