import type { Context } from "hono";
import { getBowelDay } from "../../../contexts/health/application/get-bowel-day";
import { setBowelDay } from "../../../contexts/health/application/set-bowel-day";
import type { BowelRepository } from "../../../contexts/health/domain/bowel-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { requireDay, requireFiniteNumber } from "../validation";

export interface BowelHandlerOptions {
  userRepository: UserRepository;
  bowelRepository: BowelRepository;
}

/** Protected `GET /api/bowel?day=`: the day's count, flag, and note (defaults for an unrecorded day). */
export function createGetBowelHandler(options: BowelHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const result = await getBowelDay(options.bowelRepository, userId, requireDay(c.req.query("day")));
    return c.json({ day: result.day, count: result.count, is_normal: result.isNormal, note: result.note });
  };
}

/** Protected `PUT /api/bowel`: upsert the whole day's record and return it. */
export function createSetBowelHandler(options: BowelHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();
    const log = await setBowelDay(options.bowelRepository, {
      userId,
      day: requireDay(body.day),
      count: requireFiniteNumber(body.count, "count"),
      isNormal: body.is_normal == null ? null : Boolean(body.is_normal),
      note: typeof body.note === "string" ? body.note : "",
    });
    return c.json({ day: log.day, count: log.count, is_normal: log.isNormal, note: log.note });
  };
}
