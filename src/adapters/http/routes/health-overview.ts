import type { Context } from "hono";
import { getBowelDay } from "../../../contexts/health/application/get-bowel-day";
import { getDailyTargetWithRemaining } from "../../../contexts/health/application/get-daily-target-with-remaining";
import { getDayMeals } from "../../../contexts/health/application/get-day-meals";
import { getExerciseDay } from "../../../contexts/health/application/get-exercise-day";
import { getHealthCalendar } from "../../../contexts/health/application/get-health-calendar";
import { getMenstrualOverview } from "../../../contexts/health/application/get-menstrual-overview";
import { getVitalsDay } from "../../../contexts/health/application/get-vitals-day";
import { getVitalsRange } from "../../../contexts/health/application/get-vitals-range";
import { getWaterDay } from "../../../contexts/health/application/get-water-day";
import { getWeightGoal } from "../../../contexts/health/application/get-weight-goal";
import { listExerciseActivities } from "../../../contexts/health/application/list-exercise-activities";
import { listFavoriteFoodItems } from "../../../contexts/health/application/list-favorite-food-items";
import type { BodyProfileRepository } from "../../../contexts/health/domain/body-profile-repository";
import type { BowelRepository } from "../../../contexts/health/domain/bowel-repository";
import type { DailyTargetRepository } from "../../../contexts/health/domain/daily-target-repository";
import type { ExerciseRepository } from "../../../contexts/health/domain/exercise-repository";
import type { FoodDictionaryRepository } from "../../../contexts/health/domain/food-dictionary-repository";
import type { HealthCalendarRepository } from "../../../contexts/health/domain/health-calendar-repository";
import type { MealRepository } from "../../../contexts/health/domain/meal-repository";
import type { MenstrualRepository } from "../../../contexts/health/domain/menstrual-repository";
import type { VitalsRepository } from "../../../contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../../contexts/health/domain/water-repository";
import { getCareRange } from "../../../contexts/notifications/application/get-care-range";
import { getCareToday } from "../../../contexts/notifications/application/get-care-today";
import type { CareItemRepository } from "../../../contexts/notifications/domain/care-item";
import type { CareLogRepository } from "../../../contexts/notifications/domain/care-log";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { withSubrequestBudget } from "../../../shared/db/subrequest-budget";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { optionalDayCount, requireDay } from "../validation";
import { weightGoalToJson } from "./body-profile";
import { bowelDayToJson } from "./bowel";
import { careRangeToJson, careTodayToJson } from "./care";
import { exerciseDayToJson } from "./exercise";
import { toJson as foodItemToJson } from "./food-dictionary";
import { healthCalendarToJson } from "./health-calendar";
import { dayMealsToJson } from "./meals";
import { menstrualOverviewToJson } from "./menstrual";
import { FREE_PLAN_SUBREQUEST_LIMIT, monthOf, resolveSections, section, windowEndingAt } from "./screen-sections";
import { vitalsDayToJson, vitalsRangeToJson } from "./vitals";
import { waterDayToJson } from "./water";

export interface HealthOverviewHandlerOptions {
  userRepository: UserRepository;
  bodyProfileRepository: BodyProfileRepository;
  vitalsRepository: VitalsRepository;
  healthCalendarRepository: HealthCalendarRepository;
  dailyTargetRepository: DailyTargetRepository;
  mealRepository: MealRepository;
  foodDictionaryRepository: FoodDictionaryRepository;
  waterRepository: WaterRepository;
  bowelRepository: BowelRepository;
  exerciseRepository: ExerciseRepository;
  menstrualRepository: MenstrualRepository;
  careItemRepository: CareItemRepository;
  careLogRepository: CareLogRepository;
}

/** Default window width, in days, for the trend chart and the care range (the trend UI's own span). */
const DEFAULT_WINDOW_DAYS = 30;

/**
 * Protected `GET /api/health-overview?day=&trend_days=&care_days=`: every
 * section the health screen loads, in one Worker invocation.
 *
 * `day` is required with no server-UTC fallback: a wrong day here is wrong for
 * the whole screen at once, for eight hours of every day for a UTC+8 caller.
 * Auth, `day`, and the window widths are request-level faults resolved *before*
 * the fan-out — reporting a client's malformed `day` as fourteen failed
 * sections would hide the bug behind a screen that merely looks broken.
 */
export function createGetHealthOverviewHandler(options: HealthOverviewHandlerOptions) {
  // The budget is the Workers *whole-invocation* ceiling, so it wraps the whole
  // handler, not just the fan-out: `resolveUserId` below is itself one to three
  // neon-http reads (more on the create/race path), plus a possible JWKS fetch
  // on a cold isolate, and budgeting only the sections would let the invocation
  // reach 51-53. It must also stay outside the section construction rather than
  // wrapping only `resolveSections` — `section()`'s thunks start executing
  // synchronously, so the fan-out has already begun by the time a promise is
  // passed anywhere (screen-sections.ts).
  return async (c: Context<{ Variables: AuthVariables }>) =>
    withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, async () => {
      // Once, not per section: every section needs the internal user id, and
      // resolving it inside each would add thirteen redundant reads.
      const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
      const day = requireDay(c.req.query("day"));
      const trend = windowEndingAt(day, optionalDayCount(c.req.query("trend_days"), "trend_days", DEFAULT_WINDOW_DAYS));
      const care = windowEndingAt(day, optionalDayCount(c.req.query("care_days"), "care_days", DEFAULT_WINDOW_DAYS));
      const [year, month] = monthOf(day).split("-").map(Number);
      const careDeps = {
        userRepo: options.userRepository,
        careItemRepo: options.careItemRepository,
        careLogRepo: options.careLogRepository,
      };

      // Every value here is already a running section: they start together and
      // each records its own outcome, so one failure cannot take the page down.
      const sections = await resolveSections({
        weight_goal: section(async () =>
          weightGoalToJson(await getWeightGoal(options.bodyProfileRepository, options.vitalsRepository, userId)),
        ),
        vitals_trend: section(async () => {
          const { series } = await getVitalsRange(options.vitalsRepository, userId, trend.from, trend.to);
          return vitalsRangeToJson(trend.from, trend.to, series);
        }),
        health_calendar: section(async () =>
          healthCalendarToJson(
            await getHealthCalendar(
              options.healthCalendarRepository,
              options.dailyTargetRepository,
              options.mealRepository,
              userId,
              year,
              month,
              day,
            ),
          ),
        ),
        meals: section(async () => dayMealsToJson(await getDayMeals(options.mealRepository, userId, day))),
        daily_target: section(async () =>
          getDailyTargetWithRemaining(options.dailyTargetRepository, options.mealRepository, userId, day),
        ),
        favorite_food_items: section(async () =>
          (await listFavoriteFoodItems(options.foodDictionaryRepository, userId)).map(foodItemToJson),
        ),
        water: section(async () => waterDayToJson(await getWaterDay(options.waterRepository, userId, day))),
        bowel: section(async () => bowelDayToJson(await getBowelDay(options.bowelRepository, userId, day))),
        vitals: section(async () => vitalsDayToJson(await getVitalsDay(options.vitalsRepository, userId, day))),
        exercise_activities: section(async () => ({ activities: listExerciseActivities() })),
        exercise: section(async () => exerciseDayToJson(await getExerciseDay(options.exerciseRepository, userId, day))),
        menstrual: section(async () => menstrualOverviewToJson(await getMenstrualOverview(options.menstrualRepository, userId))),
        care_today: section(async () => careTodayToJson(await getCareToday(careDeps, userId, new Date()))),
        care_range: section(async () => careRangeToJson(await getCareRange(careDeps, userId, care.from, care.to, new Date()))),
      });

      return c.json(sections);
    });
}
