import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { bowelLog } from "../../../shared/db/schema";
import type { BowelLog } from "../domain/bowel";
import type { SetBowelLogInput, BowelRepository } from "../domain/bowel-repository";

type BowelLogRow = typeof bowelLog.$inferSelect;

function toDomain(row: BowelLogRow): BowelLog {
  return { userId: row.userId, day: row.day, count: row.count, isNormal: row.isNormal, note: row.note };
}

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

  async setMany(rows: SetBowelLogInput[]): Promise<void> {
    if (rows.length === 0) return;
    const db = this.getDb();
    const [first, ...rest] = rows.map((input) => {
      const values = {
        userId: input.userId,
        day: input.day,
        count: input.count,
        isNormal: input.isNormal,
        note: input.note,
      };
      return db.insert(bowelLog).values(values).onConflictDoUpdate({ target: [bowelLog.userId, bowelLog.day], set: values });
    });
    await db.batch([first, ...rest]);
  }

  async listRange(userId: string, from: string, to: string): Promise<BowelLog[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(bowelLog)
      .where(and(eq(bowelLog.userId, userId), gte(bowelLog.day, from), lte(bowelLog.day, to)))
      .orderBy(asc(bowelLog.day));
    return rows.map(toDomain);
  }
}
