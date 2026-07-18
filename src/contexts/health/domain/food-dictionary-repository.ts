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
}
