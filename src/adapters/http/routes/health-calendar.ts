import type { Context } from "hono";
import { getHealthCalendar } from "../../../contexts/health/application/get-health-calendar";
import type { DailyTargetRepository } from "../../../contexts/health/domain/daily-target-repository";
import type { HealthCalendarRepository } from "../../../contexts/health/domain/health-calendar-repository";
import type { MealRepository } from "../../../contexts/health/domain/meal-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireMonth } from "../validation";

export interface HealthCalendarHandlerOptions {
  userRepository: UserRepository;
  healthCalendarRepository: HealthCalendarRepository;
  dailyTargetRepository: DailyTargetRepository;
  mealRepository: MealRepository;
}

/** The client's `today` (`YYYY-MM-DD`) if given and well-formed, else the server's UTC date. */
function requireTodayOrServerUtc(raw: string | undefined): string {
  if (raw == null) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new BadRequestError("today must be in YYYY-MM-DD format");
  return raw;
}

/** Protected `GET /api/health-calendar?month=YYYY-MM&today=YYYY-MM-DD`: the month's logged days + rates. */
export function createGetHealthCalendarHandler(options: HealthCalendarHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const [year, month] = requireMonth(c.req.query("month")).split("-").map(Number);
    // The client passes its local date so a UTC+n user's "days elapsed" is judged
    // against their calendar day, not the server's UTC day; fall back to server UTC.
    const today = requireTodayOrServerUtc(c.req.query("today"));
    const summary = await getHealthCalendar(
      options.healthCalendarRepository,
      options.dailyTargetRepository,
      options.mealRepository,
      userId,
      year,
      month,
      today,
    );
    return c.json({
      year: summary.year,
      month: summary.month,
      logged_days: summary.loggedDays,
      days_elapsed: summary.daysElapsed,
      logging_rate: summary.loggingRate,
      diet_adherence_rate: summary.dietAdherenceRate,
    });
  };
}
