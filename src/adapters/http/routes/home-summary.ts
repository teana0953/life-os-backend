import type { Context } from "hono";
import { getMonthlyNetWorth } from "../../../contexts/finance/application/get-monthly-networth";
import { listBudgetsWithProgress } from "../../../contexts/finance/application/list-budgets-with-progress";
import type { FinanceBudgetRepository } from "../../../contexts/finance/domain/finance-budget-repository";
import type { NetWorthRepository } from "../../../contexts/finance/domain/networth-repository";
import { getDailyTargetWithRemaining } from "../../../contexts/health/application/get-daily-target-with-remaining";
import { getMenstrualOverview } from "../../../contexts/health/application/get-menstrual-overview";
import { getVitalsRange } from "../../../contexts/health/application/get-vitals-range";
import { getWeightGoal } from "../../../contexts/health/application/get-weight-goal";
import type { BodyProfileRepository } from "../../../contexts/health/domain/body-profile-repository";
import type { DailyTargetRepository } from "../../../contexts/health/domain/daily-target-repository";
import type { MealRepository } from "../../../contexts/health/domain/meal-repository";
import type { MenstrualRepository } from "../../../contexts/health/domain/menstrual-repository";
import type { VitalsRepository } from "../../../contexts/health/domain/vitals-repository";
import { getBalances } from "../../../contexts/split/application/get-balances";
import type { BalanceRepository } from "../../../contexts/split/domain/balance-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { withSubrequestBudget } from "../../../shared/db/subrequest-budget";
import { localParts } from "../../../shared-kernel/reminder-clock";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { optionalDayCount, requireDay } from "../validation";
import { weightGoalToJson } from "./body-profile";
import { budgetsToJson, monthlyNetWorthToJson } from "./finance";
import { menstrualOverviewToJson } from "./menstrual";
import { FREE_PLAN_SUBREQUEST_LIMIT, monthOf, resolveSections, section, windowEndingAt } from "./screen-sections";
import { balancesToJson } from "./split";
import { vitalsRangeToJson } from "./vitals";

export interface HomeSummaryHandlerOptions {
  userRepository: UserRepository;
  bodyProfileRepository: BodyProfileRepository;
  vitalsRepository: VitalsRepository;
  menstrualRepository: MenstrualRepository;
  dailyTargetRepository: DailyTargetRepository;
  mealRepository: MealRepository;
  financeBudgetRepository: FinanceBudgetRepository;
  financeNetWorthRepository: NetWorthRepository;
  splitBalanceRepository: BalanceRepository;
}

/**
 * A year, not the health screen's 30 days: the home tile shows the *most
 * recent* blood-pressure sample, so a month-long lookback would blank it for
 * anyone who has not measured lately.
 */
const DEFAULT_TREND_DAYS = 366;

/**
 * Protected `GET /api/home-summary?day=&trend_days=`: every arm the home
 * dashboard loads, in one Worker invocation. `day` is required with no
 * server-UTC fallback, and auth/parameter faults stay request-level, exactly
 * as on `/api/health-overview`.
 */
export function createGetHomeSummaryHandler(options: HomeSummaryHandlerOptions) {
  // See health-overview.ts's identical wrapping for why this encloses the whole
  // handler — `resolveUserId` included — and not just the `resolveSections` call.
  return async (c: Context<{ Variables: AuthVariables }>) =>
    withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, async () => {
      const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
      const day = requireDay(c.req.query("day"));
      const trend = windowEndingAt(day, optionalDayCount(c.req.query("trend_days"), "trend_days", DEFAULT_TREND_DAYS));
      const month = monthOf(day);

      const sections = await resolveSections({
        weight_goal: section(async () =>
          weightGoalToJson(await getWeightGoal(options.bodyProfileRepository, options.vitalsRepository, userId)),
        ),
        vitals_trend: section(async () => {
          const { series } = await getVitalsRange(options.vitalsRepository, userId, trend.from, trend.to);
          return vitalsRangeToJson(trend.from, trend.to, series);
        }),
        menstrual: section(async () => menstrualOverviewToJson(await getMenstrualOverview(options.menstrualRepository, userId))),
        budgets: section(async () => budgetsToJson(month, await listBudgetsWithProgress(options.financeBudgetRepository, userId, month))),
        net_worth: section(async () => monthlyNetWorthToJson(await getMonthlyNetWorth(options.financeNetWorthRepository, userId, month))),
        split_balances: section(async () => {
          // The caller's own date, resolved here rather than in SQL — same shape
          // as `GET /api/split/balances`.
          const timezone = (await options.userRepository.getById(userId))?.timezone ?? "Asia/Taipei";
          return balancesToJson(await getBalances(options.splitBalanceRepository, userId, localParts(new Date(), timezone).date));
        }),
        daily_target: section(async () =>
          getDailyTargetWithRemaining(options.dailyTargetRepository, options.mealRepository, userId, day),
        ),
      });

      return c.json(sections);
    });
}
