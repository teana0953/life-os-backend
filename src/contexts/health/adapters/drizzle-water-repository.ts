import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { waterIntake, waterTarget } from "../../../shared/db/schema";
import type { WaterIntake, WaterTarget } from "../domain/water";
import type { SetWaterTargetInput, WaterRepository } from "../domain/water-repository";

type WaterIntakeRow = typeof waterIntake.$inferSelect;
type WaterTargetRow = typeof waterTarget.$inferSelect;

function intakeToDomain(row: WaterIntakeRow): WaterIntake {
  return { userId: row.userId, day: row.day, totalMl: Number(row.totalMl) };
}

function targetToDomain(row: WaterTargetRow): WaterTarget {
  return { userId: row.userId, day: row.day, targetMl: Number(row.targetMl) };
}

/** Driven adapter: implements WaterRepository via Drizzle + Neon. */
export class DrizzleWaterRepository implements WaterRepository {
  constructor(private readonly getDb: () => Db) {}

  async getIntake(userId: string, day: string): Promise<WaterIntake | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(waterIntake)
      .where(and(eq(waterIntake.userId, userId), eq(waterIntake.day, day)))
      .limit(1);
    return row ? intakeToDomain(row) : null;
  }

  async addIntake(userId: string, day: string, addMl: number): Promise<WaterIntake> {
    const db = this.getDb();
    // Upsert: on conflict, clamp the new running total at 0.
    const [row] = await db
      .insert(waterIntake)
      .values({ userId, day, totalMl: String(Math.max(0, addMl)) })
      .onConflictDoUpdate({
        target: [waterIntake.userId, waterIntake.day],
        set: { totalMl: sql`GREATEST(0, ${waterIntake.totalMl} + ${addMl})` },
      })
      .returning();
    if (!row) throw new Error("failed to add water intake");
    return intakeToDomain(row);
  }

  async addIntakeMany(rows: { userId: string; day: string; addMl: number }[]): Promise<void> {
    if (rows.length === 0) return;
    const db = this.getDb();
    const [first, ...rest] = rows.map(({ userId, day, addMl }) =>
      db
        .insert(waterIntake)
        .values({ userId, day, totalMl: String(Math.max(0, addMl)) })
        .onConflictDoUpdate({
          target: [waterIntake.userId, waterIntake.day],
          set: { totalMl: sql`GREATEST(0, ${waterIntake.totalMl} + ${addMl})` },
        }),
    );
    await db.batch([first, ...rest]);
  }

  async listIntakeRange(userId: string, from: string, to: string): Promise<WaterIntake[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(waterIntake)
      .where(and(eq(waterIntake.userId, userId), gte(waterIntake.day, from), lte(waterIntake.day, to)))
      .orderBy(asc(waterIntake.day));
    return rows.map(intakeToDomain);
  }

  async getTarget(userId: string, day: string): Promise<WaterTarget | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(waterTarget)
      .where(and(eq(waterTarget.userId, userId), eq(waterTarget.day, day)))
      .limit(1);
    return row ? targetToDomain(row) : null;
  }

  async getLatestTargetOnOrBefore(userId: string, day: string): Promise<WaterTarget | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(waterTarget)
      .where(and(eq(waterTarget.userId, userId), lte(waterTarget.day, day)))
      .orderBy(desc(waterTarget.day))
      .limit(1);
    return row ? targetToDomain(row) : null;
  }

  async listTargetRange(userId: string, from: string, to: string): Promise<WaterTarget[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(waterTarget)
      .where(and(eq(waterTarget.userId, userId), gte(waterTarget.day, from), lte(waterTarget.day, to)))
      .orderBy(asc(waterTarget.day));
    return rows.map(targetToDomain);
  }

  async setTarget(input: SetWaterTargetInput): Promise<WaterTarget> {
    const db = this.getDb();
    const values = { userId: input.userId, day: input.day, targetMl: String(input.targetMl) };
    const [row] = await db
      .insert(waterTarget)
      .values(values)
      .onConflictDoUpdate({ target: [waterTarget.userId, waterTarget.day], set: values })
      .returning();
    if (!row) throw new Error("failed to set water target");
    return targetToDomain(row);
  }

  async setTargetMany(rows: SetWaterTargetInput[]): Promise<void> {
    if (rows.length === 0) return;
    const db = this.getDb();
    const [first, ...rest] = rows.map((input) => {
      const values = { userId: input.userId, day: input.day, targetMl: String(input.targetMl) };
      return db.insert(waterTarget).values(values).onConflictDoUpdate({ target: [waterTarget.userId, waterTarget.day], set: values });
    });
    await db.batch([first, ...rest]);
  }
}
