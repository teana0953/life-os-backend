import type { Context } from "hono";
import { addWater } from "../../../contexts/health/application/add-water";
import { getWaterDay, type WaterDay } from "../../../contexts/health/application/get-water-day";
import { setWaterTarget } from "../../../contexts/health/application/set-water-target";
import type { WaterRepository } from "../../../contexts/health/domain/water-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { requireDay, requireFiniteNumber } from "../validation";

export interface WaterHandlerOptions {
  userRepository: UserRepository;
  waterRepository: WaterRepository;
}

/** The day's water figures as JSON; shared with the health-overview batch section so the two cannot drift. */
export function waterDayToJson(result: WaterDay) {
  return {
    day: result.day,
    total_ml: result.totalMl,
    target_ml: result.targetMl,
    remaining_ml: result.remainingMl,
  };
}

/** Protected `GET /api/water?day=`: the day's total, resolved target, and remaining (may be negative). */
export function createGetWaterHandler(options: WaterHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const result = await getWaterDay(options.waterRepository, userId, requireDay(c.req.query("day")));
    return c.json(waterDayToJson(result));
  };
}

/** Protected `POST /api/water`: add water to a day's total (add_ml may be negative; total clamps at 0). */
export function createAddWaterHandler(options: WaterHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const intake = await addWater(
      options.waterRepository,
      userId,
      requireDay(body.day),
      requireFiniteNumber(body.add_ml, "add_ml"),
    );
    return c.json({ day: intake.day, total_ml: intake.totalMl });
  };
}

/** Protected `PUT /api/water/target`: set (upsert) a day's water target. */
export function createSetWaterTargetHandler(options: WaterHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const target = await setWaterTarget(options.waterRepository, {
      userId,
      day: requireDay(body.day),
      targetMl: requireFiniteNumber(body.target_ml, "target_ml"),
    });
    return c.json({ day: target.day, target_ml: target.targetMl });
  };
}
