import type { Context } from "hono";
import { importChaodaysWeight } from "../../../contexts/health/application/import-chaodays-weight";
import type { ChaodaysClient } from "../../../contexts/health/domain/chaodays-client";
import type { VitalsRepository } from "../../../contexts/health/domain/vitals-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { requireDay, requireString, BadRequestError } from "../validation";

export interface ImportChaodaysHandlerOptions {
  userRepository: UserRepository;
  vitalsRepository: VitalsRepository;
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
