import { and, eq, ilike, isNull, or } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { foodFavorite, foodItem } from "../../../shared/db/schema";
import type {
  CreateCustomFoodItemInput,
  CreateSharedFoodItemInput,
  FoodDictionaryRepository,
  UpdateSharedFoodItemPatch,
} from "../domain/food-dictionary-repository";
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
    baseAmount: row.baseAmount === null ? null : Number(row.baseAmount),
    measureUnit: row.measureUnit,
    createdAt: row.createdAt,
  };
}

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

  async findSharedById(id: string): Promise<FoodItem | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(foodItem)
      .where(and(eq(foodItem.id, id), isNull(foodItem.ownerUserId)))
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

  async createShared(input: CreateSharedFoodItemInput): Promise<FoodItem> {
    const db = this.getDb();
    const [created] = await db
      .insert(foodItem)
      .values({
        ownerUserId: null,
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
        baseAmount: input.baseAmount === null ? null : String(input.baseAmount),
        measureUnit: input.measureUnit,
      })
      .returning();
    if (!created) throw new Error("failed to create shared food item");
    return toDomain(created);
  }

  async updateSharedById(id: string, patch: UpdateSharedFoodItemPatch): Promise<FoodItem | null> {
    const db = this.getDb();
    const set: Record<string, string | null> = {};
    if ("name" in patch && patch.name !== undefined) set.name = patch.name;
    if ("carbG" in patch && patch.carbG !== undefined) set.carbG = String(patch.carbG);
    if ("proteinG" in patch && patch.proteinG !== undefined) set.proteinG = String(patch.proteinG);
    if ("fatG" in patch && patch.fatG !== undefined) set.fatG = String(patch.fatG);
    if ("sugarG" in patch && patch.sugarG !== undefined) set.sugarG = String(patch.sugarG);
    if ("fiberG" in patch && patch.fiberG !== undefined) set.fiberG = String(patch.fiberG);
    if ("kcal" in patch && patch.kcal !== undefined) set.kcal = String(patch.kcal);
    if ("staple" in patch && patch.staple !== undefined) set.staple = String(patch.staple);
    if ("meat" in patch && patch.meat !== undefined) set.meat = String(patch.meat);
    if ("fruit" in patch && patch.fruit !== undefined) set.fruit = String(patch.fruit);
    if ("veg" in patch && patch.veg !== undefined) set.veg = String(patch.veg);
    if ("baseAmount" in patch) set.baseAmount = patch.baseAmount === null ? null : String(patch.baseAmount);
    if ("measureUnit" in patch) set.measureUnit = patch.measureUnit ?? null;

    const [updated] = await db
      .update(foodItem)
      .set(set)
      .where(and(eq(foodItem.id, id), isNull(foodItem.ownerUserId)))
      .returning();
    return updated ? toDomain(updated) : null;
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
