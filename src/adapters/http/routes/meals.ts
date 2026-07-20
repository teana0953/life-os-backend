import type { Context } from "hono";
import { createMeal, type CreateMealItem } from "../../../contexts/health/application/create-meal";
import { deleteMeal } from "../../../contexts/health/application/delete-meal";
import { deleteMealItem } from "../../../contexts/health/application/delete-meal-item";
import { getDayMeals, type MealItemView } from "../../../contexts/health/application/get-day-meals";
import { getLoggedDays } from "../../../contexts/health/application/get-logged-days";
import { EmptyUpdateError, updateMealItem } from "../../../contexts/health/application/update-meal-item";
import { updateMealTime } from "../../../contexts/health/application/update-meal-time";
import type { FoodDictionaryRepository } from "../../../contexts/health/domain/food-dictionary-repository";
import type { MealEntry, MealItem, MealSummary } from "../../../contexts/health/domain/meal-entry";
import type { MealRepository, UpdateMealItemPatch } from "../../../contexts/health/domain/meal-repository";
import { NullBaseMeasureError, scaleByQuantity, type Scalable } from "../../../contexts/health/domain/quantity";
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
  requireMonth,
  requireString,
  requireTimestamp,
} from "../validation";

export interface MealHandlerOptions {
  userRepository: UserRepository;
  mealRepository: MealRepository;
  foodDictionaryRepository: FoodDictionaryRepository;
}

function scalableToJson(s: Scalable) {
  return {
    carb_g: s.carbG,
    protein_g: s.proteinG,
    fat_g: s.fatG,
    sugar_g: s.sugarG,
    fiber_g: s.fiberG,
    kcal: s.kcal,
    staple: s.staple,
    meat: s.meat,
    fruit: s.fruit,
    veg: s.veg,
  };
}

function mealItemToJson(item: MealItem, consumed: Scalable = scaleByQuantity(item, item.quantity)) {
  return {
    id: item.id,
    food_item_id: item.foodItemId,
    name: item.name,
    photo_ref: item.photoRef,
    source: item.source,
    unclassified: item.unclassified,
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
    quantity: item.quantity,
    base_amount: item.baseAmount,
    measure_unit: item.measureUnit,
    consumed: scalableToJson(consumed),
  };
}

function mealToJson(meal: MealEntry) {
  return {
    id: meal.id,
    day: meal.day,
    meal: meal.meal,
    time: meal.time.toISOString(),
    items: meal.items.map((item) => mealItemToJson(item)),
  };
}

function mealSummaryToJson(meal: MealSummary) {
  return { id: meal.id, day: meal.day, meal: meal.meal, time: meal.time.toISOString() };
}

function mealItemViewToJson(item: MealItemView) {
  return mealItemToJson(item, item.consumed);
}

function parseCreateMealItem(raw: unknown, index: number): CreateMealItem {
  if (typeof raw !== "object" || raw === null) {
    throw new BadRequestError(`items[${index}] must be an object`);
  }
  const item = raw as Record<string, unknown>;

  if (item.food_item_id !== undefined) {
    const quantity = optionalPositiveFiniteNumber(item.quantity, `items[${index}].quantity`);
    const measure = optionalPositiveFiniteNumber(item.measure, `items[${index}].measure`);
    if (quantity !== undefined && measure !== undefined) {
      throw new BadRequestError(`items[${index}]: quantity and measure are mutually exclusive`);
    }
    return { foodItemId: requireString(item.food_item_id, `items[${index}].food_item_id`), quantity, measure };
  }

  const name = typeof item.name === "string" ? item.name : null;
  const photoRef = typeof item.photo_ref === "string" ? item.photo_ref : null;

  if (item.portions && typeof item.portions === "object") {
    const portions = item.portions as Record<string, unknown>;
    return {
      name,
      photoRef,
      portions: {
        staple: optionalFiniteNumber(portions.staple, `items[${index}].portions.staple`, 0),
        meat: optionalFiniteNumber(portions.meat, `items[${index}].portions.meat`, 0),
        fruit: optionalFiniteNumber(portions.fruit, `items[${index}].portions.fruit`, 0),
        veg: optionalFiniteNumber(portions.veg, `items[${index}].portions.veg`, 0),
      },
    };
  }

  const nutrients = (item.nutrients ?? {}) as Record<string, unknown>;
  return {
    name,
    photoRef,
    nutrients: {
      carbG: optionalFiniteNumber(nutrients.carb_g, `items[${index}].nutrients.carb_g`, 0),
      proteinG: optionalFiniteNumber(nutrients.protein_g, `items[${index}].nutrients.protein_g`, 0),
      fatG: optionalFiniteNumber(nutrients.fat_g, `items[${index}].nutrients.fat_g`, 0),
      sugarG: optionalFiniteNumber(nutrients.sugar_g, `items[${index}].nutrients.sugar_g`, 0),
      fiberG: optionalFiniteNumber(nutrients.fiber_g, `items[${index}].nutrients.fiber_g`, 0),
      kcal: optionalFiniteNumberOrUndefined(nutrients.kcal, `items[${index}].nutrients.kcal`),
    },
  };
}

/** Protected `POST /api/meals`: create-or-append a meal (upsert on user/day/meal) with one or more items. */
export function createCreateMealHandler(options: MealHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const day = requireDay(body.day);
    const meal = requireString(body.meal, "meal");
    const time = optionalTimestamp(body.time, "time");

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestError("items must be a non-empty array");
    }
    const items = body.items.map((raw, index) => parseCreateMealItem(raw, index));

    try {
      const created = await createMeal(options.mealRepository, options.foodDictionaryRepository, {
        userId,
        day,
        meal,
        time,
        items,
      });
      return c.json(mealToJson(created), 201);
    } catch (err) {
      if (err instanceof NullBaseMeasureError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `GET /api/meals?day=`: a day's meals (with items, ordered by time) and nutrient/portion totals. */
export function createGetDayMealsHandler(options: MealHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const dayLog = await getDayMeals(options.mealRepository, userId, requireDay(c.req.query("day")));
    return c.json({
      day: dayLog.day,
      meals: dayLog.meals.map((meal) => ({
        id: meal.id,
        meal: meal.meal,
        time: meal.time.toISOString(),
        items: meal.items.map(mealItemViewToJson),
      })),
      totals: {
        ...scalableToJson({ ...dayLog.totals.nutrients, ...dayLog.totals.portions }),
      },
    });
  };
}

/** Protected `GET /api/meals/logged-days?month=`: the caller's distinct logged days in a month. */
export function createGetLoggedDaysHandler(options: MealHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const days = await getLoggedDays(options.mealRepository, userId, requireMonth(c.req.query("month")));
    return c.json({ days });
  };
}

/** Protected `PATCH /api/meals/:id`: update a meal's time (day unchanged). */
export function createUpdateMealTimeHandler(options: MealHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const time = requireTimestamp(body.time, "time");

    const meal = await updateMealTime(options.mealRepository, userId, c.req.param("id") ?? "", time);
    if (!meal) return c.json({ error: "not_found" }, 404);
    return c.json(mealSummaryToJson(meal));
  };
}

/** Protected `DELETE /api/meals/:id`: delete one of the caller's own meals (cascades its items). */
export function createDeleteMealHandler(options: MealHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const deleted = await deleteMeal(options.mealRepository, userId, c.req.param("id") ?? "");
    if (!deleted) return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  };
}

/** Protected `PATCH /api/meal-items/:id`: update an item (quantity | measure | portions). */
export function createUpdateMealItemHandler(options: MealHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const quantity = optionalPositiveFiniteNumber(body.quantity, "quantity");
    const measure = optionalPositiveFiniteNumber(body.measure, "measure");
    if (quantity !== undefined && measure !== undefined) {
      throw new BadRequestError("quantity and measure are mutually exclusive");
    }

    const patch: UpdateMealItemPatch = {};
    if (quantity !== undefined) patch.quantity = quantity;
    if (measure !== undefined) patch.measure = measure;
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
      const item = await updateMealItem(options.mealRepository, userId, c.req.param("id") ?? "", patch);
      if (!item) return c.json({ error: "not_found" }, 404);
      return c.json(mealItemToJson(item));
    } catch (err) {
      if (err instanceof EmptyUpdateError || err instanceof NullBaseMeasureError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `DELETE /api/meal-items/:id`: delete a single item. */
export function createDeleteMealItemHandler(options: MealHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const deleted = await deleteMealItem(options.mealRepository, userId, c.req.param("id") ?? "");
    if (!deleted) return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  };
}
