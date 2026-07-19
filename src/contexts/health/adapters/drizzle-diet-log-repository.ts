import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { foodEntry } from "../../../shared/db/schema";
import { portionsToNutrients } from "../domain/conversion";
import type { CreateFoodEntryInput, DietLogRepository, UpdateFoodEntryPatch } from "../domain/diet-log-repository";
import type { FoodEntry } from "../domain/food-entry";

type FoodEntryRow = typeof foodEntry.$inferSelect;

function toDomain(row: FoodEntryRow): FoodEntry {
  return {
    id: row.id,
    userId: row.userId,
    day: row.day,
    meal: row.meal,
    name: row.name,
    photoRef: row.photoRef,
    source: row.source,
    unclassified: row.unclassified,
    carbG: Number(row.carbG),
    proteinG: Number(row.proteinG),
    fatG: Number(row.fatG),
    sugarG: Number(row.sugarG),
    fiberG: Number(row.fiberG),
    kcal: Number(row.kcal),
    staple: Number(row.staple),
    meat: Number(row.meat),
    fruit: Number(row.fruit),
    veg: Number(row.veg),
    eatenAt: row.eatenAt,
    loggedAt: row.loggedAt,
  };
}

/** Driven adapter: implements DietLogRepository via Drizzle + Neon. */
export class DrizzleDietLogRepository implements DietLogRepository {
  constructor(private readonly getDb: () => Db) {}

  async create(input: CreateFoodEntryInput): Promise<FoodEntry> {
    const db = this.getDb();
    const [created] = await db
      .insert(foodEntry)
      .values({
        userId: input.userId,
        day: input.day,
        meal: input.meal,
        name: input.name,
        photoRef: input.photoRef,
        source: input.source,
        unclassified: input.unclassified,
        carbG: String(input.carbG),
        proteinG: String(input.proteinG),
        fatG: String(input.fatG),
        sugarG: String(input.sugarG),
        fiberG: String(input.fiberG),
        kcal: String(input.kcal),
        staple: String(input.staple),
        meat: String(input.meat),
        fruit: String(input.fruit),
        veg: String(input.veg),
        eatenAt: input.eatenAt,
      })
      .returning();
    if (!created) throw new Error("failed to create food entry");
    return toDomain(created);
  }

  async listByDay(userId: string, day: string): Promise<FoodEntry[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(foodEntry)
      .where(and(eq(foodEntry.userId, userId), eq(foodEntry.day, day)));
    return rows.map(toDomain);
  }

  async delete(userId: string, entryId: string): Promise<boolean> {
    const db = this.getDb();
    const deleted = await db
      .delete(foodEntry)
      .where(and(eq(foodEntry.userId, userId), eq(foodEntry.id, entryId)))
      .returning({ id: foodEntry.id });
    return deleted.length > 0;
  }

  async update(userId: string, entryId: string, patch: UpdateFoodEntryPatch): Promise<FoodEntry | null> {
    const db = this.getDb();
    const values: Partial<typeof foodEntry.$inferInsert> = {};

    if (patch.name !== undefined) values.name = patch.name;
    if (patch.meal !== undefined) values.meal = patch.meal;
    if (patch.eatenAt !== undefined) {
      values.eatenAt = patch.eatenAt;
      values.day = patch.eatenAt.toISOString().slice(0, 10);
    }
    if (patch.portions !== undefined) {
      const nutrients = portionsToNutrients(patch.portions);
      values.unclassified = false;
      values.carbG = String(nutrients.carbG);
      values.proteinG = String(nutrients.proteinG);
      values.fatG = String(nutrients.fatG);
      values.sugarG = String(nutrients.sugarG);
      values.fiberG = String(nutrients.fiberG);
      values.kcal = String(nutrients.kcal);
      values.staple = String(patch.portions.staple);
      values.meat = String(patch.portions.meat);
      values.fruit = String(patch.portions.fruit);
      values.veg = String(patch.portions.veg);
    }

    const [updated] = await db
      .update(foodEntry)
      .set(values)
      .where(and(eq(foodEntry.userId, userId), eq(foodEntry.id, entryId)))
      .returning();
    return updated ? toDomain(updated) : null;
  }

  async listLoggedDays(userId: string, month: string): Promise<string[]> {
    const db = this.getDb();
    const rows = await db
      .selectDistinct({ day: foodEntry.day })
      .from(foodEntry)
      .where(
        and(
          eq(foodEntry.userId, userId),
          gte(foodEntry.day, `${month}-01`),
          sql`${foodEntry.day} < (${`${month}-01`})::date + interval '1 month'`,
        ),
      )
      .orderBy(asc(foodEntry.day));
    return rows.map((row) => row.day);
  }
}
