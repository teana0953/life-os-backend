import { and, eq, ilike, isNull, or } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { foodFavorite, foodItem } from "../../../shared/db/schema";
import type { CreateCustomFoodItemInput, FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { FoodItem } from "../domain/food-item";

type FoodItemRow = typeof foodItem.$inferSelect;

function toDomain(row: FoodItemRow): FoodItem {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
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
    createdAt: row.createdAt,
  };
}

/** Driven adapter: implements FoodDictionaryRepository via Drizzle + Neon. */
export class DrizzleFoodDictionaryRepository implements FoodDictionaryRepository {
  constructor(private readonly getDb: () => Db) {}

  async search(userId: string, query: string): Promise<FoodItem[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(foodItem)
      .where(and(or(isNull(foodItem.ownerUserId), eq(foodItem.ownerUserId, userId)), ilike(foodItem.name, `%${query}%`)));
    return rows.map(toDomain);
  }

  async findById(userId: string, id: string): Promise<FoodItem | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(foodItem)
      .where(and(eq(foodItem.id, id), or(isNull(foodItem.ownerUserId), eq(foodItem.ownerUserId, userId))))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async createCustom(input: CreateCustomFoodItemInput): Promise<FoodItem> {
    const db = this.getDb();
    const [created] = await db
      .insert(foodItem)
      .values({
        ownerUserId: input.ownerUserId,
        name: input.name,
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
      })
      .returning();
    if (!created) throw new Error("failed to create custom food item");
    return toDomain(created);
  }

  async favorite(userId: string, foodItemId: string): Promise<void> {
    const db = this.getDb();
    await db
      .insert(foodFavorite)
      .values({ userId, foodItemId })
      .onConflictDoNothing({ target: [foodFavorite.userId, foodFavorite.foodItemId] });
  }

  async unfavorite(userId: string, foodItemId: string): Promise<void> {
    const db = this.getDb();
    await db
      .delete(foodFavorite)
      .where(and(eq(foodFavorite.userId, userId), eq(foodFavorite.foodItemId, foodItemId)));
  }

  async listFavorites(userId: string): Promise<FoodItem[]> {
    const db = this.getDb();
    const rows = await db
      .select({ foodItem: foodItem })
      .from(foodFavorite)
      .innerJoin(foodItem, eq(foodFavorite.foodItemId, foodItem.id))
      .where(eq(foodFavorite.userId, userId));
    return rows.map((r) => toDomain(r.foodItem));
  }
}
