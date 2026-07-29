import type { Context } from "hono";
import { createSharedFoodItem, InvalidFoodItemError } from "../../../contexts/health/application/create-shared-food-item";
import { updateSharedFoodItem } from "../../../contexts/health/application/update-shared-food-item";
import type { FoodDictionaryRepository, UpdateSharedFoodItemPatch } from "../../../contexts/health/domain/food-dictionary-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveAdminUser } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import {
  BadRequestError,
  nullablePositiveNumber,
  nullableString,
  optionalFiniteNumber,
  requireFiniteNumber,
  requireString,
} from "../validation";
import { toJson } from "./food-dictionary";

export interface AdminFoodDictionaryHandlerOptions {
  userRepository: UserRepository;
  foodDictionaryRepository: FoodDictionaryRepository;
}

/** `food_item.id` is a uuid column; a non-UUID `:id` is rejected as 404 before it ever reaches the repository (D13 in design.md). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Protected `POST /api/admin/food-items`: create a shared (no-owner) food item; 403 for a non-administrator. */
export function createCreateSharedFoodItemHandler(options: AdminFoodDictionaryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const admin = await resolveAdminUser(options.userRepository, c.get("firebaseClaims"));
    if (!admin) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json<Record<string, unknown>>();
    try {
      const item = await createSharedFoodItem(options.foodDictionaryRepository, {
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
        baseAmount: body.base_amount === undefined ? null : nullablePositiveNumber(body.base_amount, "base_amount"),
        measureUnit: body.measure_unit === undefined ? null : nullableString(body.measure_unit, "measure_unit"),
      });
      return c.json(toJson(item), 201);
    } catch (err) {
      if (err instanceof InvalidFoodItemError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/**
 * Protected `PATCH /api/admin/food-items/:id`: partial-update a shared food
 * item; 403 for a non-administrator, 404 for a non-shared/unknown/malformed
 * id, 400 for an empty or otherwise invalid patch. Absent keys are left
 * alone; `id`/`owner_user_id`/`created_at` are ignored if present in the body.
 */
export function createUpdateSharedFoodItemHandler(options: AdminFoodDictionaryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const admin = await resolveAdminUser(options.userRepository, c.get("firebaseClaims"));
    if (!admin) return c.json({ error: "forbidden" }, 403);

    const id = c.req.param("id") ?? "";
    if (!UUID_RE.test(id)) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const patch: UpdateSharedFoodItemPatch = {};
    if ("name" in body) patch.name = requireString(body.name, "name");
    if ("carb_g" in body) patch.carbG = requireFiniteNumber(body.carb_g, "carb_g");
    if ("protein_g" in body) patch.proteinG = requireFiniteNumber(body.protein_g, "protein_g");
    if ("fat_g" in body) patch.fatG = requireFiniteNumber(body.fat_g, "fat_g");
    if ("sugar_g" in body) patch.sugarG = requireFiniteNumber(body.sugar_g, "sugar_g");
    if ("fiber_g" in body) patch.fiberG = requireFiniteNumber(body.fiber_g, "fiber_g");
    if ("kcal" in body) patch.kcal = requireFiniteNumber(body.kcal, "kcal");
    if ("staple" in body) patch.staple = requireFiniteNumber(body.staple, "staple");
    if ("meat" in body) patch.meat = requireFiniteNumber(body.meat, "meat");
    if ("fruit" in body) patch.fruit = requireFiniteNumber(body.fruit, "fruit");
    if ("veg" in body) patch.veg = requireFiniteNumber(body.veg, "veg");
    if ("base_amount" in body) patch.baseAmount = nullablePositiveNumber(body.base_amount, "base_amount");
    if ("measure_unit" in body) patch.measureUnit = nullableString(body.measure_unit, "measure_unit");

    try {
      const item = await updateSharedFoodItem(options.foodDictionaryRepository, id, patch);
      if (!item) return c.json({ error: "not_found" }, 404);
      return c.json(toJson(item));
    } catch (err) {
      if (err instanceof InvalidFoodItemError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}
