import type { Context } from "hono";
import { deleteFoodEntry } from "../../../contexts/health/application/delete-food-entry";
import { getDayDietLog } from "../../../contexts/health/application/get-day-diet-log";
import { logFoodEntryFromDictionary } from "../../../contexts/health/application/log-food-entry-from-dictionary";
import { logManualFoodEntry } from "../../../contexts/health/application/log-manual-food-entry";
import { EmptyUpdateError, updateFoodEntry } from "../../../contexts/health/application/update-food-entry";
import type { DietLogRepository, UpdateFoodEntryPatch } from "../../../contexts/health/domain/diet-log-repository";
import type { FoodDictionaryRepository } from "../../../contexts/health/domain/food-dictionary-repository";
import type { FoodEntry } from "../../../contexts/health/domain/food-entry";
import { NullBaseGramsError } from "../../../contexts/health/domain/quantity";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import {
  BadRequestError,
  optionalFiniteNumber,
  optionalFiniteNumberOrUndefined,
  optionalPositiveFiniteNumber,
  optionalTimestamp,
  requireDay,
  requireString,
} from "../validation";

export interface DietEntryHandlerOptions {
  userRepository: UserRepository;
  dietLogRepository: DietLogRepository;
  foodDictionaryRepository: FoodDictionaryRepository;
}

function entryToJson(entry: FoodEntry) {
  return {
    id: entry.id,
    day: entry.day,
    meal: entry.meal,
    name: entry.name,
    photo_ref: entry.photoRef,
    source: entry.source,
    unclassified: entry.unclassified,
    carb_g: entry.carbG,
    protein_g: entry.proteinG,
    fat_g: entry.fatG,
    sugar_g: entry.sugarG,
    fiber_g: entry.fiberG,
    kcal: entry.kcal,
    staple: entry.staple,
    meat: entry.meat,
    fruit: entry.fruit,
    veg: entry.veg,
    eaten_at: entry.eatenAt.toISOString(),
    logged_at: entry.loggedAt.toISOString(),
  };
}

/**
 * Protected `POST /api/diet-entries`: log a food entry, either from a
 * dictionary item (`food_item_id`) or manually (`portions` or `nutrients`).
 */
export function createLogFoodEntryHandler(options: DietEntryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const day = requireDay(body.day);
    const meal = requireString(body.meal, "meal");
    const name = typeof body.name === "string" ? body.name : null;
    const photoRef = typeof body.photo_ref === "string" ? body.photo_ref : null;
    const eatenAt = optionalTimestamp(body.eaten_at, "eaten_at");

    if (body.food_item_id !== undefined) {
      const quantity = optionalPositiveFiniteNumber(body.quantity, "quantity");
      const grams = optionalPositiveFiniteNumber(body.grams, "grams");
      if (quantity !== undefined && grams !== undefined) {
        throw new BadRequestError("quantity and grams are mutually exclusive");
      }

      try {
        const entry = await logFoodEntryFromDictionary(options.dietLogRepository, options.foodDictionaryRepository, {
          userId,
          day,
          meal,
          foodItemId: requireString(body.food_item_id, "food_item_id"),
          quantity,
          grams,
          eatenAt,
        });
        return c.json(entryToJson(entry), 201);
      } catch (err) {
        if (err instanceof NullBaseGramsError) throw new BadRequestError(err.message);
        throw err;
      }
    }

    if (body.portions && typeof body.portions === "object") {
      const portions = body.portions as Record<string, unknown>;
      const entry = await logManualFoodEntry(options.dietLogRepository, {
        userId,
        day,
        meal,
        name,
        photoRef,
        eatenAt,
        portions: {
          staple: optionalFiniteNumber(portions.staple, "portions.staple", 0),
          meat: optionalFiniteNumber(portions.meat, "portions.meat", 0),
          fruit: optionalFiniteNumber(portions.fruit, "portions.fruit", 0),
          veg: optionalFiniteNumber(portions.veg, "portions.veg", 0),
        },
      });
      return c.json(entryToJson(entry), 201);
    }

    const nutrients = (body.nutrients ?? {}) as Record<string, unknown>;
    const entry = await logManualFoodEntry(options.dietLogRepository, {
      userId,
      day,
      meal,
      name,
      photoRef,
      eatenAt,
      nutrients: {
        carbG: optionalFiniteNumber(nutrients.carb_g, "nutrients.carb_g", 0),
        proteinG: optionalFiniteNumber(nutrients.protein_g, "nutrients.protein_g", 0),
        fatG: optionalFiniteNumber(nutrients.fat_g, "nutrients.fat_g", 0),
        sugarG: optionalFiniteNumber(nutrients.sugar_g, "nutrients.sugar_g", 0),
        fiberG: optionalFiniteNumber(nutrients.fiber_g, "nutrients.fiber_g", 0),
        kcal: optionalFiniteNumberOrUndefined(nutrients.kcal, "nutrients.kcal"),
      },
    });
    return c.json(entryToJson(entry), 201);
  };
}

/** Protected `GET /api/diet-entries?day=`: a day's entries grouped by meal, with nutrient totals. */
export function createGetDayDietLogHandler(options: DietEntryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const dayLog = await getDayDietLog(options.dietLogRepository, userId, requireDay(c.req.query("day")));
    return c.json({
      day: dayLog.day,
      meals: dayLog.meals.map((meal) => ({ meal: meal.meal, entries: meal.entries.map(entryToJson) })),
      totals: dayLog.totals,
    });
  };
}

/** Protected `DELETE /api/diet-entries/:id`: delete one of the caller's own entries. */
export function createDeleteFoodEntryHandler(options: DietEntryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const deleted = await deleteFoodEntry(options.dietLogRepository, userId, c.req.param("id") ?? "");
    if (!deleted) return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  };
}

/** Protected `PATCH /api/diet-entries/:id`: partially update one of the caller's own entries. */
export function createUpdateFoodEntryHandler(options: DietEntryHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const patch: UpdateFoodEntryPatch = {};
    if (body.name !== undefined) patch.name = typeof body.name === "string" ? body.name : null;
    if (body.meal !== undefined) patch.meal = requireString(body.meal, "meal");
    if (body.eaten_at !== undefined) patch.eatenAt = optionalTimestamp(body.eaten_at, "eaten_at");
    if (body.portions && typeof body.portions === "object") {
      const portions = body.portions as Record<string, unknown>;
      patch.portions = {
        staple: optionalFiniteNumber(portions.staple, "portions.staple", 0),
        meat: optionalFiniteNumber(portions.meat, "portions.meat", 0),
        fruit: optionalFiniteNumber(portions.fruit, "portions.fruit", 0),
        veg: optionalFiniteNumber(portions.veg, "portions.veg", 0),
      };
    }

    try {
      const entry = await updateFoodEntry(options.dietLogRepository, userId, c.req.param("id") ?? "", patch);
      if (!entry) return c.json({ error: "not_found" }, 404);
      return c.json(entryToJson(entry));
    } catch (err) {
      if (err instanceof EmptyUpdateError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}
