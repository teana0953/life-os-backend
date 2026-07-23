import type { Portions } from "../domain/conversion";
import type { DailyTargetRepository } from "../domain/daily-target-repository";
import type { HealthCalendarRepository } from "../domain/health-calendar-repository";
import type { MealRepository } from "../domain/meal-repository";
import { scaleByQuantity } from "../domain/quantity";

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
const ZERO_PORTIONS: Portions = { staple: 0, meat: 0, fruit: 0, veg: 0 };

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

  // Batched diet adherence: fetch the month's targets and meals once and resolve
  // each day in memory (rather than ~3 queries per day), keeping the request well
  // under the Workers subrequest limit. `dayBefore` carries a target set before the
  // month into day 1, matching getDailyTargetWithRemaining's carry-forward.
  const dayBefore = new Date(Date.UTC(year, month - 1, 1) - 86_400_000).toISOString().slice(0, 10);
  const [carryBefore, targetsInRange, meals] = await Promise.all([
    dailyTargetRepository.getLatestOnOrBefore(userId, dayBefore),
    dailyTargetRepository.listInRange(userId, from, elapsedBoundary),
    mealRepository.listMealsInRange(userId, from, elapsedBoundary),
  ]);

  const loggedByDay = new Map<string, Portions>();
  for (const meal of meals) {
    const acc = loggedByDay.get(meal.day) ?? { ...ZERO_PORTIONS };
    for (const item of meal.items) {
      const consumed = scaleByQuantity(item, item.quantity);
      acc.staple += consumed.staple;
      acc.meat += consumed.meat;
      acc.fruit += consumed.fruit;
      acc.veg += consumed.veg;
    }
    loggedByDay.set(meal.day, acc);
  }
  const exactByDay = new Map(targetsInRange.map((t) => [t.day, t]));

  // Walk the elapsed days ascending, carrying the most recent target's base forward
  // (bonus applies only on a target's exact day).
  let base: Portions = carryBefore
    ? { staple: carryBefore.baseStaple, meat: carryBefore.baseMeat, fruit: carryBefore.baseFruit, veg: carryBefore.baseVeg }
    : { ...ZERO_PORTIONS };
  let metDays = 0;
  for (let d = 1; d <= daysElapsed; d++) {
    const day = `${year}-${pad2(month)}-${pad2(d)}`;
    const exact = exactByDay.get(day);
    let bonus: Portions = ZERO_PORTIONS;
    if (exact) {
      base = { staple: exact.baseStaple, meat: exact.baseMeat, fruit: exact.baseFruit, veg: exact.baseVeg };
      bonus = { staple: exact.bonusStaple, meat: exact.bonusMeat, fruit: exact.bonusFruit, veg: exact.bonusVeg };
    }
    const effective = {
      staple: base.staple + bonus.staple,
      meat: base.meat + bonus.meat,
      fruit: base.fruit + bonus.fruit,
      veg: base.veg + bonus.veg,
    };
    const logged = loggedByDay.get(day) ?? ZERO_PORTIONS;
    const hasTarget = effective.staple + effective.meat + effective.fruit + effective.veg > 0;
    const allMet =
      effective.staple - logged.staple <= EPSILON &&
      effective.meat - logged.meat <= EPSILON &&
      effective.fruit - logged.fruit <= EPSILON &&
      effective.veg - logged.veg <= EPSILON;
    if (hasTarget && allMet) metDays++;
  }

  return {
    year,
    month,
    loggedDays,
    daysElapsed,
    loggingRate: Math.round((100 * loggedInElapsed) / daysElapsed),
    dietAdherenceRate: Math.round((100 * metDays) / daysElapsed),
  };
}
