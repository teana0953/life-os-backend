import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { dailyTarget } from "../../../shared/db/schema";
import type { DailyTarget } from "../domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../domain/daily-target-repository";

type DailyTargetRow = typeof dailyTarget.$inferSelect;

function toDomain(row: DailyTargetRow): DailyTarget {
  return {
    id: row.id,
    userId: row.userId,
    day: row.day,
    baseStaple: Number(row.baseStaple),
    baseMeat: Number(row.baseMeat),
    baseFruit: Number(row.baseFruit),
    baseVeg: Number(row.baseVeg),
    bonusStaple: Number(row.bonusStaple),
    bonusMeat: Number(row.bonusMeat),
    bonusFruit: Number(row.bonusFruit),
    bonusVeg: Number(row.bonusVeg),
  };
}

export class DrizzleDailyTargetRepository implements DailyTargetRepository {
  constructor(private readonly getDb: () => Db) {}

  async get(userId: string, day: string): Promise<DailyTarget | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(dailyTarget)
      .where(and(eq(dailyTarget.userId, userId), eq(dailyTarget.day, day)))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async getLatestOnOrBefore(userId: string, day: string): Promise<DailyTarget | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(dailyTarget)
      .where(and(eq(dailyTarget.userId, userId), lte(dailyTarget.day, day)))
      .orderBy(desc(dailyTarget.day))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async listInRange(userId: string, from: string, to: string): Promise<DailyTarget[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(dailyTarget)
      .where(and(eq(dailyTarget.userId, userId), gte(dailyTarget.day, from), lte(dailyTarget.day, to)))
      .orderBy(asc(dailyTarget.day));
    return rows.map(toDomain);
  }

  async set(input: SetDailyTargetInput): Promise<DailyTarget> {
    const db = this.getDb();
    const values = {
      userId: input.userId,
      day: input.day,
      baseStaple: String(input.baseStaple),
      baseMeat: String(input.baseMeat),
      baseFruit: String(input.baseFruit),
      baseVeg: String(input.baseVeg),
      bonusStaple: String(input.bonusStaple ?? 0),
      bonusMeat: String(input.bonusMeat ?? 0),
      bonusFruit: String(input.bonusFruit ?? 0),
      bonusVeg: String(input.bonusVeg ?? 0),
    };
    const [row] = await db
      .insert(dailyTarget)
      .values(values)
      .onConflictDoUpdate({ target: [dailyTarget.userId, dailyTarget.day], set: values })
      .returning();
    if (!row) throw new Error("failed to set daily target");
    return toDomain(row);
  }

  async setMany(rows: SetDailyTargetInput[]): Promise<void> {
    if (rows.length === 0) return;
    const db = this.getDb();
    const [first, ...rest] = rows.map((input) => {
      // Bonus columns are included only when the input provides them, so an
      // omitted bonus takes the DB default on insert and is left untouched
      // (not reset) on conflict — the exercise bonus is preserved.
      const values = {
        userId: input.userId,
        day: input.day,
        baseStaple: String(input.baseStaple),
        baseMeat: String(input.baseMeat),
        baseFruit: String(input.baseFruit),
        baseVeg: String(input.baseVeg),
        ...(input.bonusStaple !== undefined ? { bonusStaple: String(input.bonusStaple) } : {}),
        ...(input.bonusMeat !== undefined ? { bonusMeat: String(input.bonusMeat) } : {}),
        ...(input.bonusFruit !== undefined ? { bonusFruit: String(input.bonusFruit) } : {}),
        ...(input.bonusVeg !== undefined ? { bonusVeg: String(input.bonusVeg) } : {}),
      };
      return db.insert(dailyTarget).values(values).onConflictDoUpdate({ target: [dailyTarget.userId, dailyTarget.day], set: values });
    });
    await db.batch([first, ...rest]);
  }
}
