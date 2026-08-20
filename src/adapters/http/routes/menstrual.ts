import type { Context } from "hono";
import { addPeriod, InvalidPeriodError } from "../../../contexts/health/application/add-period";
import { deletePeriod } from "../../../contexts/health/application/delete-period";
import { getMenstrualOverview, type MenstrualOverview } from "../../../contexts/health/application/get-menstrual-overview";
import { updatePeriod } from "../../../contexts/health/application/update-period";
import type { MenstrualPeriod } from "../../../contexts/health/domain/menstrual-period";
import type { MenstrualRepository, UpdatePeriodPatch } from "../../../contexts/health/domain/menstrual-repository";
import type { MenstrualStats } from "../../../contexts/health/domain/menstrual-stats";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay } from "../validation";

export interface MenstrualHandlerOptions {
  userRepository: UserRepository;
  menstrualRepository: MenstrualRepository;
}

function periodToJson(period: MenstrualPeriod) {
  return { id: period.id, start_date: period.startDate, end_date: period.endDate };
}

function statsToJson(stats: MenstrualStats) {
  return {
    average_cycle_days: stats.averageCycleDays,
    average_period_days: stats.averagePeriodDays,
    predicted_next_start: stats.predictedNextStart,
  };
}

/** The menstrual overview as JSON; shared with the batch sections so the two cannot drift. */
export function menstrualOverviewToJson(overview: MenstrualOverview) {
  return {
    periods: overview.periods.map(periodToJson),
    stats: statsToJson(overview.stats),
    last_period: overview.lastPeriod ? periodToJson(overview.lastPeriod) : null,
  };
}

/** Protected `GET /api/menstrual`: the user's periods, derived stats, and last period. */
export function createGetMenstrualHandler(options: MenstrualHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const overview = await getMenstrualOverview(options.menstrualRepository, userId);
    return c.json(menstrualOverviewToJson(overview));
  };
}

/**
 * Parse an `end_date` field value: a day string → a validated day; an explicit
 * `null` or an absent field → null; anything else (a number, boolean, object)
 * → 400. This stops a junk value from being silently treated as "no end date",
 * which on PATCH would clear a stored end date (silent data loss).
 */
function parseEndDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return requireDay(value, "end_date");
  throw new BadRequestError("end_date must be a date string or null");
}

/** Protected `POST /api/menstrual`: add a period and return it. */
export function createAddMenstrualHandler(options: MenstrualHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const startDate = requireDay(body.start_date, "start_date");
    const endDate = parseEndDate(body.end_date);

    try {
      const period = await addPeriod(options.menstrualRepository, { userId, startDate, endDate });
      return c.json(periodToJson(period));
    } catch (err) {
      if (err instanceof InvalidPeriodError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `PATCH /api/menstrual/:id`: partial-update an owned period; 404 when not owned/found. */
export function createUpdateMenstrualHandler(options: MenstrualHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    // Build the patch by KEY PRESENCE: an absent field is left untouched; an
    // explicit `end_date: null` clears the stored end date.
    const patch: UpdatePeriodPatch = {};
    if ("start_date" in body) patch.startDate = requireDay(body.start_date, "start_date");
    if ("end_date" in body) patch.endDate = parseEndDate(body.end_date);

    try {
      const period = await updatePeriod(options.menstrualRepository, userId, c.req.param("id") ?? "", patch);
      if (!period) return c.json({ error: "not_found" }, 404);
      return c.json(periodToJson(period));
    } catch (err) {
      if (err instanceof InvalidPeriodError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `DELETE /api/menstrual/:id`: delete an owned period; reports whether one was deleted. */
export function createDeleteMenstrualHandler(options: MenstrualHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const deleted = await deletePeriod(options.menstrualRepository, userId, c.req.param("id") ?? "");
    return c.json({ deleted });
  };
}
