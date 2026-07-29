import type { FoodItem } from "./food-item";

export interface CreateCustomFoodItemInput {
  ownerUserId: string;
  name: string;
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal: number;
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
}

/** Like CreateCustomFoodItemInput but for a shared (no-owner) item, with an optional measure basis. */
export interface CreateSharedFoodItemInput {
  name: string;
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal: number;
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
  baseAmount: number | null;
  measureUnit: string | null;
}

/**
 * Partial update to a shared item: every key is optional (absent = leave
 * alone). `baseAmount`/`measureUnit` may additionally be explicitly `null`
 * (clear); the other fields never accept `null`.
 */
export interface UpdateSharedFoodItemPatch {
  name?: string;
  carbG?: number;
  proteinG?: number;
  fatG?: number;
  sugarG?: number;
  fiberG?: number;
  kcal?: number;
  staple?: number;
  meat?: number;
  fruit?: number;
  veg?: number;
  baseAmount?: number | null;
  measureUnit?: string | null;
}

/**
 * Port for the food dictionary. Shared (seeded) items have `ownerUserId ===
 * null` and are visible to every user; custom items are visible only to the
 * owner that created them.
 */
export interface FoodDictionaryRepository {
  /** Case-insensitive substring match over shared items ∪ the given user's own custom items. */
  search(userId: string, query: string): Promise<FoodItem[]>;
  /** Fetch an item visible to the user: a shared item, or one of the user's own custom items. Returns null for another user's private custom item. */
  findById(userId: string, id: string): Promise<FoodItem | null>;
  createCustom(input: CreateCustomFoodItemInput): Promise<FoodItem>;
  favorite(userId: string, foodItemId: string): Promise<void>;
  unfavorite(userId: string, foodItemId: string): Promise<void>;
  listFavorites(userId: string): Promise<FoodItem[]>;
  /** Fetch a shared item by id. Returns null when the id is unknown or belongs to a user's custom item. */
  findSharedById(id: string): Promise<FoodItem | null>;
  createShared(input: CreateSharedFoodItemInput): Promise<FoodItem>;
  /** Partial-updates a shared item. Returns null (no write) when the id is unknown or not shared. */
  updateSharedById(id: string, patch: UpdateSharedFoodItemPatch): Promise<FoodItem | null>;
}
