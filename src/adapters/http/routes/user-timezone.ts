import type { Context } from "hono";
import { restartCareDayBestEffort } from "../../../contexts/notifications/application/restart-care-day";
import type { CareDayInstanceManager } from "../../../contexts/notifications/domain/care-day-instance";
import type { CareItemRepository } from "../../../contexts/notifications/domain/care-item";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireString } from "../validation";

export interface UserTimezoneHandlerOptions {
  userRepository: UserRepository;
  /** Read by the restart hook's gate (skip when the caller has no upcoming care day). */
  careItemRepository: CareItemRepository;
  /** Optional: best-effort restarts today's instance so the new timezone takes effect within seconds (key_decisions "即時生效機制"). */
  careDayInstanceManager?: CareDayInstanceManager;
}

/**
 * A non-empty string that `Intl.DateTimeFormat` accepts as an IANA timezone;
 * throws otherwise (D8 in add-medication-reminders/design.md). Constructing
 * the formatter with an unknown zone throws `RangeError`.
 */
function requireIanaTimezone(value: unknown, field: string): string {
  const s = requireString(value, field);
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: s });
  } catch {
    throw new BadRequestError(`${field} must be a valid IANA timezone`);
  }
  return s;
}

/** Protected `PUT /api/user/timezone`: set the caller's IANA timezone. */
export function createSetUserTimezoneHandler(options: UserTimezoneHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const timezone = requireIanaTimezone(body.timezone, "timezone");
    await options.userRepository.updateTimezone(userId, timezone);
    if (options.careDayInstanceManager) {
      await restartCareDayBestEffort(userId, options.careDayInstanceManager, options.userRepository, options.careItemRepository);
    }
    return c.json({ timezone });
  };
}
