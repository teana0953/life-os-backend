import type { Context } from "hono";
import { createCustomFoodItem } from "../../../contexts/health/application/create-custom-food-item";
import { favoriteFoodItem } from "../../../contexts/health/application/favorite-food-item";
import { listFavoriteFoodItems } from "../../../contexts/health/application/list-favorite-food-items";
import { searchFoodDictionary } from "../../../contexts/health/application/search-food-dictionary";
import { unfavoriteFoodItem } from "../../../contexts/health/application/unfavorite-food-item";
import type { FoodDictionaryRepository } from "../../../contexts/health/domain/food-dictionary-repository";
import type { FoodItem } from "../../../contexts/health/domain/food-item";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { optionalFiniteNumber, requireFiniteNumber, requireString } from "../validation";

export interface FoodDictionaryHandlerOptions {
  userRepository: UserRepository;
  foodDictionaryRepository: FoodDictionaryRepository;
}

function toJson(item: FoodItem) {
  return {
    id: item.id,
    owner_user_id: item.ownerUserId,
    name: item.name,
    carb_g: item.carbG,
    protein_g: item.proteinG,
    fat_g: item.fatG,
    sugar_g: item.sugarG,
    fiber_g: item.fiberG,
    kcal: item.kcal,
    staple: item.staple,
    meat: item.meat,
    fruit: item.fruit,
    veg: item.veg,
    base_grams: item.baseGrams,
  };
}

/** Protected `GET /api/food-items?q=`: search shared items ∪ the user's own custom items. */
export function createSearchFoodDictionaryHandler(options: FoodDictionaryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const items = await searchFoodDictionary(options.foodDictionaryRepository, userId, c.req.query("q") ?? "");
    return c.json(items.map(toJson));
  };
}

/** Protected `POST /api/food-items`: create a food item owned by (visible only to) the caller. */
export function createCustomFoodItemHandler(options: FoodDictionaryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const item = await createCustomFoodItem(options.foodDictionaryRepository, {
      ownerUserId: userId,
      name: requireString(body.name, "name"),
      carbG: requireFiniteNumber(body.carb_g, "carb_g"),
      proteinG: requireFiniteNumber(body.protein_g, "protein_g"),
      fatG: requireFiniteNumber(body.fat_g, "fat_g"),
      sugarG: requireFiniteNumber(body.sugar_g, "sugar_g"),
      fiberG: requireFiniteNumber(body.fiber_g, "fiber_g"),
      kcal: requireFiniteNumber(body.kcal, "kcal"),
      staple: optionalFiniteNumber(body.staple, "staple", 0),
      meat: optionalFiniteNumber(body.meat, "meat", 0),
      fruit: optionalFiniteNumber(body.fruit, "fruit", 0),
      veg: optionalFiniteNumber(body.veg, "veg", 0),
    });
    return c.json(toJson(item), 201);
  };
}

/** Protected `POST /api/food-items/:id/favorite`: mark an item as a favorite. */
export function createFavoriteFoodItemHandler(options: FoodDictionaryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    await favoriteFoodItem(options.foodDictionaryRepository, userId, c.req.param("id") ?? "");
    return c.body(null, 204);
  };
}

/** Protected `DELETE /api/food-items/:id/favorite`: unmark an item as a favorite. */
export function createUnfavoriteFoodItemHandler(options: FoodDictionaryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    await unfavoriteFoodItem(options.foodDictionaryRepository, userId, c.req.param("id") ?? "");
    return c.body(null, 204);
  };
}

/** Protected `GET /api/food-items/favorites`: list the caller's favorite items. */
export function createListFavoriteFoodItemsHandler(options: FoodDictionaryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const items = await listFavoriteFoodItems(options.foodDictionaryRepository, userId);
    return c.json(items.map(toJson));
  };
}
