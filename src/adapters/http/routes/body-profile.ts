import type { Context } from "hono";
import { getBodyProfile } from "../../../contexts/health/application/get-body-profile";
import { getWeightGoal } from "../../../contexts/health/application/get-weight-goal";
import { InvalidBodyProfileError, setBodyProfile } from "../../../contexts/health/application/set-body-profile";
import type { BodyProfile } from "../../../contexts/health/domain/body-profile";
import type { BodyProfileRepository, UpdateBodyProfilePatch } from "../../../contexts/health/domain/body-profile-repository";
import type { VitalsRepository } from "../../../contexts/health/domain/vitals-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError } from "../validation";

export interface BodyProfileHandlerOptions {
  userRepository: UserRepository;
  bodyProfileRepository: BodyProfileRepository;
  vitalsRepository: VitalsRepository;
}

/**
 * A finite number strictly greater than 0 → itself; anything else (0, negative,
 * a numeric string, an object, null) → 400. Unlike `optionalPositiveFiniteNumber`
 * this never treats a junk value as "absent" — the caller only calls it for keys
 * that are present in the body.
 */
function parsePositiveNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  throw new BadRequestError(`${field} must be a positive number`);
}

function profileToJson(profile: BodyProfile) {
  return { height_cm: profile.heightCm, target_weight_kg: profile.targetWeightKg };
}

/** Protected `GET /api/body-profile`: the user's height and target weight (nulls when unset). */
export function createGetBodyProfileHandler(options: BodyProfileHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const profile = await getBodyProfile(options.bodyProfileRepository, userId);
    return c.json(profileToJson(profile));
  };
}

/** Protected `PUT /api/body-profile`: partial upsert (by key presence) and return the profile. */
export function createSetBodyProfileHandler(options: BodyProfileHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    // Build the patch by KEY PRESENCE: an absent field is left untouched; a
    // present field must be a positive number or the write is a 400.
    const patch: UpdateBodyProfilePatch = {};
    if ("height_cm" in body) patch.heightCm = parsePositiveNumber(body.height_cm, "height_cm");
    if ("target_weight_kg" in body) patch.targetWeightKg = parsePositiveNumber(body.target_weight_kg, "target_weight_kg");

    try {
      const profile = await setBodyProfile(options.bodyProfileRepository, userId, patch);
      return c.json(profileToJson(profile));
    } catch (err) {
      if (err instanceof InvalidBodyProfileError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `GET /api/weight-goal`: the derived weight-goal overview. */
export function createGetWeightGoalHandler(options: BodyProfileHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const overview = await getWeightGoal(options.bodyProfileRepository, options.vitalsRepository, userId);
    return c.json({
      height_cm: overview.heightCm,
      target_weight_kg: overview.targetWeightKg,
      current_weight_kg: overview.currentWeightKg,
      remaining_kg: overview.remainingKg,
      achievement_rate: overview.achievementRate,
      bmi: overview.bmi,
    });
  };
}
