import type { Context } from "hono";
import { getHealthCalendar } from "../../../contexts/health/application/get-health-calendar";
import type { DailyTargetRepository } from "../../../contexts/health/domain/daily-target-repository";
import type { HealthCalendarRepository } from "../../../contexts/health/domain/health-calendar-repository";
import type { MealRepository } from "../../../contexts/health/domain/meal-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { requireMonth } from "../validation";

export interface HealthCalendarHandlerOptions {
  userRepository: UserRepository;
  healthCalendarRepository: HealthCalendarRepository;
  dailyTargetRepository: DailyTargetRepository;
  mealRepository: MealRepository;
}

/** Protected `GET /api/health-calendar?month=YYYY-MM`: the month's logged days + rates. */
export function createGetHealthCalendarHandler(options: HealthCalendarHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const [year, month] = requireMonth(c.req.query("month")).split("-").map(Number);
    const today = new Date().toISOString().slice(0, 10);
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
