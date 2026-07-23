import type { DailyTargetRepository } from "../domain/daily-target-repository";
import type { HealthCalendarRepository } from "../domain/health-calendar-repository";
import type { MealRepository } from "../domain/meal-repository";
import { getDailyTargetWithRemaining } from "./get-daily-target-with-remaining";

export interface HealthCalendarSummary {
  year: number;
  /** 1–12. */
  month: number;
  /** Days in the month with any tracker entry (`YYYY-MM-DD`, ascending). */
  loggedDays: string[];
  /** Days counted so far: day-of-month for the current month, the full month for
   * a past month, 0 for a future month. */
  daysElapsed: number;
  /** round(100 × logged / elapsed), 0–100; null when no days have elapsed. */
  loggingRate: number | null;
  /** round(100 × diet-target-met days / elapsed), 0–100; null when elapsed is 0. */
  dietAdherenceRate: number | null;
}

const EPSILON = 1e-9;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Number of days in `month` (1–12) of `year`. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Use case: a month's health-calendar summary — which days had any tracker
 * activity, and how consistently the user logged and met their diet target over
 * the elapsed days of the month. `today` (`YYYY-MM-DD`) bounds "elapsed" so the
 * current month isn't judged against days that haven't happened yet.
 */
export async function getHealthCalendar(
  calendarRepository: HealthCalendarRepository,
  dailyTargetRepository: DailyTargetRepository,
  mealRepository: MealRepository,
  userId: string,
  year: number,
  month: number,
  today: string,
): Promise<HealthCalendarSummary> {
  const total = daysInMonth(year, month);
  const from = `${year}-${pad2(month)}-01`;
  const to = `${year}-${pad2(month)}-${pad2(total)}`;

  const [ty, tm, td] = today.split("-").map(Number);
  const requestedIndex = year * 12 + month;
  const todayIndex = ty * 12 + tm;
  const daysElapsed =
    requestedIndex > todayIndex
      ? 0
      : requestedIndex < todayIndex
        ? total
        : Math.min(td, total);

  const loggedDays = await calendarRepository.listLoggedDays(userId, from, to);

  if (daysElapsed === 0) {
    return { year, month, loggedDays, daysElapsed: 0, loggingRate: null, dietAdherenceRate: null };
  }

  const elapsedBoundary = `${year}-${pad2(month)}-${pad2(daysElapsed)}`;
  const loggedInElapsed = loggedDays.filter((day) => day <= elapsedBoundary).length;

  const days = Array.from({ length: daysElapsed }, (_, i) => `${year}-${pad2(month)}-${pad2(i + 1)}`);
  const targets = await Promise.all(
    days.map((day) => getDailyTargetWithRemaining(dailyTargetRepository, mealRepository, userId, day)),
  );
  const metDays = targets.filter((t) => {
    const hasTarget = t.effective.staple + t.effective.meat + t.effective.fruit + t.effective.veg > 0;
    const allMet =
      t.remaining.staple <= EPSILON &&
      t.remaining.meat <= EPSILON &&
      t.remaining.fruit <= EPSILON &&
      t.remaining.veg <= EPSILON;
    return hasTarget && allMet;
  }).length;

  return {
    year,
    month,
    loggedDays,
    daysElapsed,
    loggingRate: Math.round((100 * loggedInElapsed) / daysElapsed),
    dietAdherenceRate: Math.round((100 * metDays) / daysElapsed),
  };
}
