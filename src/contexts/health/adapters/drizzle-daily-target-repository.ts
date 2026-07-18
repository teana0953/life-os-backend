import { and, eq } from "drizzle-orm";
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

/** Driven adapter: implements DailyTargetRepository via Drizzle + Neon. */
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
}
