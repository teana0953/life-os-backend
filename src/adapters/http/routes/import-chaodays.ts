import type { Context } from "hono";
import { importChaodaysBowel } from "../../../contexts/health/application/import-chaodays-bowel";
import { importChaodaysDiet } from "../../../contexts/health/application/import-chaodays-diet";
import { importChaodaysWater } from "../../../contexts/health/application/import-chaodays-water";
import { importChaodaysWeight } from "../../../contexts/health/application/import-chaodays-weight";
import type { BowelRepository } from "../../../contexts/health/domain/bowel-repository";
import type { ChaodaysClient } from "../../../contexts/health/domain/chaodays-client";
// TEMP DIAGNOSTIC (remove after diagnosing the diet import 500):
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../../contexts/health/domain/chaodays-client";
import type { MealRepository } from "../../../contexts/health/domain/meal-repository";
import type { VitalsRepository } from "../../../contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../../contexts/health/domain/water-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { requireDay, requireString, BadRequestError } from "../validation";

export interface ImportChaodaysHandlerOptions {
  userRepository: UserRepository;
  vitalsRepository: VitalsRepository;
  chaodaysClient: ChaodaysClient;
}

export interface ImportChaodaysDietHandlerOptions {
  userRepository: UserRepository;
  mealRepository: MealRepository;
  vitalsRepository: VitalsRepository;
  chaodaysClient: ChaodaysClient;
}

export interface ImportChaodaysWaterHandlerOptions {
  userRepository: UserRepository;
  waterRepository: WaterRepository;
  chaodaysClient: ChaodaysClient;
}

export interface ImportChaodaysBowelHandlerOptions {
  userRepository: UserRepository;
  bowelRepository: BowelRepository;
  chaodaysClient: ChaodaysClient;
}

/**
 * Protected `POST /api/import/chaodays/weight`: sign in to chaodays with the
 * supplied credentials, pull weight/body-fat records for `[start_date, end_date]`,
 * and import them into the user's vitals. Credentials are used only for this
 * request — never persisted.
 */
export function createImportChaodaysWeightHandler(options: ImportChaodaysHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const uid = requireString(body.chaodays_uid, "chaodays_uid");
    const password = requireString(body.chaodays_password, "chaodays_password");
    const from = requireDay(body.start_date, "start_date");
    const to = requireDay(body.end_date, "end_date");
    if (from > to) throw new BadRequestError("start_date must not be later than end_date");

    const summary = await importChaodaysWeight(options.vitalsRepository, options.chaodaysClient, {
      userId,
      uid,
      password,
      from,
      to,
    });
    return c.json(summary);
  };
}

/**
 * Protected `POST /api/import/chaodays/diet`: sign in to chaodays with the
 * supplied credentials, pull diet records for `[start_date, end_date]`, and
 * import their food items into meals plus any embedded blood-glucose text
 * into vitals. Credentials are used only for this request — never persisted.
 */
export function createImportChaodaysDietHandler(options: ImportChaodaysDietHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const uid = requireString(body.chaodays_uid, "chaodays_uid");
    const password = requireString(body.chaodays_password, "chaodays_password");
    const from = requireDay(body.start_date, "start_date");
    const to = requireDay(body.end_date, "end_date");
    if (from > to) throw new BadRequestError("start_date must not be later than end_date");

    // TEMP DIAGNOSTIC (remove after diagnosing the diet import 500): surface the
    // real error message in the response so the failing DB write / value is visible.
    try {
      const summary = await importChaodaysDiet(options.mealRepository, options.vitalsRepository, options.chaodaysClient, {
        userId,
        uid,
        password,
        from,
        to,
      });
      return c.json(summary);
    } catch (e) {
      if (e instanceof ChaodaysAuthError || e instanceof ChaodaysUpstreamError) throw e;
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return c.json({ error: "diet_import_failed_DIAG", detail: detail.slice(0, 400) }, 500);
    }
  };
}

/**
 * Protected `POST /api/import/chaodays/water`: sign in to chaodays with the
 * supplied credentials, pull water records for `[start_date, end_date]`, sum
 * each day's entries, and add them to that day's lifeos intake. Credentials
 * are used only for this request — never persisted.
 */
export function createImportChaodaysWaterHandler(options: ImportChaodaysWaterHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const uid = requireString(body.chaodays_uid, "chaodays_uid");
    const password = requireString(body.chaodays_password, "chaodays_password");
    const from = requireDay(body.start_date, "start_date");
    const to = requireDay(body.end_date, "end_date");
    if (from > to) throw new BadRequestError("start_date must not be later than end_date");

    const summary = await importChaodaysWater(options.waterRepository, options.chaodaysClient, {
      userId,
      uid,
      password,
      from,
      to,
    });
    return c.json(summary);
  };
}

/**
 * Protected `POST /api/import/chaodays/bowel`: sign in to chaodays with the
 * supplied credentials, pull defecation records for `[start_date, end_date]`,
 * and aggregate each day's records into one lifeos bowel log. Credentials
 * are used only for this request — never persisted.
 */
export function createImportChaodaysBowelHandler(options: ImportChaodaysBowelHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const uid = requireString(body.chaodays_uid, "chaodays_uid");
    const password = requireString(body.chaodays_password, "chaodays_password");
    const from = requireDay(body.start_date, "start_date");
    const to = requireDay(body.end_date, "end_date");
    if (from > to) throw new BadRequestError("start_date must not be later than end_date");

    const summary = await importChaodaysBowel(options.bowelRepository, options.chaodaysClient, {
      userId,
      uid,
      password,
      from,
      to,
    });
    return c.json(summary);
  };
}
