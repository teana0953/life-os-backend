import type { Context } from "hono";
import { getDailyTargetWithRemaining } from "../../../contexts/health/application/get-daily-target-with-remaining";
import { setDailyTarget } from "../../../contexts/health/application/set-daily-target";
import type { DailyTargetRepository } from "../../../contexts/health/domain/daily-target-repository";
import type { DietLogRepository } from "../../../contexts/health/domain/diet-log-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { optionalFiniteNumberOrUndefined, requireDay, requireFiniteNumber } from "../validation";

export interface DailyTargetHandlerOptions {
  userRepository: UserRepository;
  dailyTargetRepository: DailyTargetRepository;
  dietLogRepository: DietLogRepository;
}

/** Protected `GET /api/daily-target?day=`: effective target (base+bonus) and remaining portions for a day. */
export function createGetDailyTargetHandler(options: DailyTargetHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const result = await getDailyTargetWithRemaining(
      options.dailyTargetRepository,
      options.dietLogRepository,
      userId,
      requireDay(c.req.query("day")),
    );
    return c.json(result);
  };
}

/** Protected `PUT /api/daily-target`: set (upsert) a day's base portion goals. */
export function createSetDailyTargetHandler(options: DailyTargetHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const target = await setDailyTarget(options.dailyTargetRepository, {
      userId,
      day: requireDay(body.day),
      baseStaple: requireFiniteNumber(body.base_staple, "base_staple"),
      baseMeat: requireFiniteNumber(body.base_meat, "base_meat"),
      baseFruit: requireFiniteNumber(body.base_fruit, "base_fruit"),
      baseVeg: requireFiniteNumber(body.base_veg, "base_veg"),
      bonusStaple: optionalFiniteNumberOrUndefined(body.bonus_staple, "bonus_staple"),
      bonusMeat: optionalFiniteNumberOrUndefined(body.bonus_meat, "bonus_meat"),
      bonusFruit: optionalFiniteNumberOrUndefined(body.bonus_fruit, "bonus_fruit"),
      bonusVeg: optionalFiniteNumberOrUndefined(body.bonus_veg, "bonus_veg"),
    });
    return c.json({
      id: target.id,
      day: target.day,
      base_staple: target.baseStaple,
      base_meat: target.baseMeat,
      base_fruit: target.baseFruit,
      base_veg: target.baseVeg,
      bonus_staple: target.bonusStaple,
      bonus_meat: target.bonusMeat,
      bonus_fruit: target.bonusFruit,
      bonus_veg: target.bonusVeg,
    });
  };
}
