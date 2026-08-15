import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { mealEntry, mealItem } from "../../../shared/db/schema";
import { portionsToNutrients } from "../domain/conversion";
import type { MealEntry, MealItem, MealSummary } from "../domain/meal-entry";
import type {
  CreateMealEntryInput,
  CreateMealItemForEntryInput,
  CreateMealItemInput,
  MealRepository,
  UpdateMealItemPatch,
  UpsertMealWithItemsInput,
} from "../domain/meal-repository";
import { measureToQuantity } from "../domain/quantity";

type MealEntryRow = typeof mealEntry.$inferSelect;
type MealItemRow = typeof mealItem.$inferSelect;

function toMealSummary(row: MealEntryRow): MealSummary {
  return { id: row.id, userId: row.userId, day: row.day, meal: row.meal, time: row.time, createdAt: row.createdAt };
}

function toMealItem(row: MealItemRow): MealItem {
  return {
    id: row.id,
    mealEntryId: row.mealEntryId,
    foodItemId: row.foodItemId,
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
    quantity: Number(row.quantity),
    baseAmount: row.baseAmount === null ? null : Number(row.baseAmount),
    measureUnit: row.measureUnit,
    createdAt: row.createdAt,
  };
}

function itemToRow(mealEntryId: string, item: CreateMealItemInput): typeof mealItem.$inferInsert {
  return {
    mealEntryId,
    foodItemId: item.foodItemId,
    name: item.name,
    photoRef: item.photoRef,
    source: item.source,
    unclassified: item.unclassified,
    carbG: String(item.carbG),
    proteinG: String(item.proteinG),
    fatG: String(item.fatG),
    sugarG: String(item.sugarG),
    fiberG: String(item.fiberG),
    kcal: String(item.kcal),
    staple: String(item.staple),
    meat: String(item.meat),
    fruit: String(item.fruit),
    veg: String(item.veg),
    quantity: String(item.quantity),
    baseAmount: item.baseAmount === null ? null : String(item.baseAmount),
    measureUnit: item.measureUnit,
  };
}

export class DrizzleMealRepository implements MealRepository {
  constructor(private readonly getDb: () => Db) {}

  async upsertMealWithItems(input: UpsertMealWithItemsInput): Promise<MealEntry> {
    const db = this.getDb();

    const [existing] = await db
      .select()
      .from(mealEntry)
      .where(and(eq(mealEntry.userId, input.userId), eq(mealEntry.day, input.day), eq(mealEntry.meal, input.meal)))
      .limit(1);

    let mealRow = existing;
    if (!mealRow) {
      const values: typeof mealEntry.$inferInsert = { userId: input.userId, day: input.day, meal: input.meal };
      if (input.time !== undefined) values.time = input.time;
      const [created] = await db.insert(mealEntry).values(values).returning();
      if (!created) throw new Error("failed to create meal");
      mealRow = created;
    }

    if (input.items.length > 0) {
      await db.insert(mealItem).values(input.items.map((item) => itemToRow(mealRow.id, item)));
    }

    const items = await db.select().from(mealItem).where(eq(mealItem.mealEntryId, mealRow.id));
    return { ...toMealSummary(mealRow), items: items.map(toMealItem) };
  }

  async createMeals(entries: CreateMealEntryInput[], items: CreateMealItemForEntryInput[]): Promise<void> {
    if (entries.length === 0) return;
    const db = this.getDb();
    const entryRows = entries.map((entry) => ({ id: entry.id, userId: entry.userId, day: entry.day, meal: entry.meal, time: entry.time }));
    const entryInsert = db.insert(mealEntry).values(entryRows);
    // Only batch the meal_item insert when there are items — neon-http rejects an
    // empty VALUES tuple (defensive: today's caller always pairs entries with items).
    if (items.length === 0) {
      await db.batch([entryInsert]);
      return;
    }
    const itemInsert = db.insert(mealItem).values(items.map((item) => itemToRow(item.mealEntryId, item)));
    await db.batch([entryInsert, itemInsert]);
  }

  async listMealsByDay(userId: string, day: string): Promise<MealEntry[]> {
    const db = this.getDb();
    const meals = await db
      .select()
      .from(mealEntry)
      .where(and(eq(mealEntry.userId, userId), eq(mealEntry.day, day)));
    if (meals.length === 0) return [];

    const items = await db
      .select()
      .from(mealItem)
      .where(
        inArray(
          mealItem.mealEntryId,
          meals.map((m) => m.id),
        ),
      );
    const itemsByMeal = new Map<string, MealItemRow[]>();
    for (const item of items) {
      const list = itemsByMeal.get(item.mealEntryId) ?? [];
      list.push(item);
      itemsByMeal.set(item.mealEntryId, list);
    }

    return meals.map((meal) => ({ ...toMealSummary(meal), items: (itemsByMeal.get(meal.id) ?? []).map(toMealItem) }));
  }

  async listMealsInRange(userId: string, from: string, to: string): Promise<MealEntry[]> {
    const db = this.getDb();
    const meals = await db
      .select()
      .from(mealEntry)
      .where(and(eq(mealEntry.userId, userId), gte(mealEntry.day, from), lte(mealEntry.day, to)));
    if (meals.length === 0) return [];

    const items = await db
      .select()
      .from(mealItem)
      .where(
        inArray(
          mealItem.mealEntryId,
          meals.map((m) => m.id),
        ),
      );
    const itemsByMeal = new Map<string, MealItemRow[]>();
    for (const item of items) {
      const list = itemsByMeal.get(item.mealEntryId) ?? [];
      list.push(item);
      itemsByMeal.set(item.mealEntryId, list);
    }

    return meals.map((meal) => ({ ...toMealSummary(meal), items: (itemsByMeal.get(meal.id) ?? []).map(toMealItem) }));
  }

  async listLoggedDays(userId: string, month: string): Promise<string[]> {
    const db = this.getDb();
    const rows = await db
      .selectDistinct({ day: mealEntry.day })
      .from(mealEntry)
      .where(
        and(
          eq(mealEntry.userId, userId),
          gte(mealEntry.day, `${month}-01`),
          sql`${mealEntry.day} < (${`${month}-01`})::date + interval '1 month'`,
        ),
      )
      .orderBy(asc(mealEntry.day));
    return rows.map((row) => row.day);
  }

  async updateMealTime(userId: string, mealId: string, time: Date): Promise<MealSummary | null> {
    const db = this.getDb();
    const [updated] = await db
      .update(mealEntry)
      .set({ time })
      .where(and(eq(mealEntry.userId, userId), eq(mealEntry.id, mealId)))
      .returning();
    return updated ? toMealSummary(updated) : null;
  }

  async deleteMeal(userId: string, mealId: string): Promise<boolean> {
    const db = this.getDb();
    const deleted = await db
      .delete(mealEntry)
      .where(and(eq(mealEntry.userId, userId), eq(mealEntry.id, mealId)))
      .returning({ id: mealEntry.id });
    return deleted.length > 0;
  }

  async updateItem(userId: string, itemId: string, patch: UpdateMealItemPatch): Promise<MealItem | null> {
    const db = this.getDb();
    const [row] = await db
      .select({ item: mealItem })
      .from(mealItem)
      .innerJoin(mealEntry, eq(mealItem.mealEntryId, mealEntry.id))
      .where(and(eq(mealItem.id, itemId), eq(mealEntry.userId, userId)))
      .limit(1);
    if (!row) return null;
    const current = row.item;

    const values: Partial<typeof mealItem.$inferInsert> = {};
    if (patch.quantity !== undefined) {
      values.quantity = String(patch.quantity);
    } else if (patch.measure !== undefined) {
      const baseAmount = current.baseAmount === null ? null : Number(current.baseAmount);
      values.quantity = String(measureToQuantity(patch.measure, baseAmount));
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

    const [updated] = await db.update(mealItem).set(values).where(eq(mealItem.id, itemId)).returning();
    return updated ? toMealItem(updated) : null;
  }

  async deleteItem(userId: string, itemId: string): Promise<boolean> {
    const db = this.getDb();
    const deleted = await db
      .delete(mealItem)
      .where(
        and(
          eq(mealItem.id, itemId),
          inArray(
            mealItem.mealEntryId,
            db.select({ id: mealEntry.id }).from(mealEntry).where(eq(mealEntry.userId, userId)),
          ),
        ),
      )
      .returning({ id: mealItem.id });
    return deleted.length > 0;
  }
}
