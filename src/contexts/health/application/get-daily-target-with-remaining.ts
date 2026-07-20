import type { Portions } from "../domain/conversion";
import type { DailyTargetRepository } from "../domain/daily-target-repository";
import type { MealRepository } from "../domain/meal-repository";
import { scaleByQuantity } from "../domain/quantity";

export interface DailyTargetWithRemaining {
  day: string;
  base: Portions;
  bonus: Portions;
  effective: Portions;
  logged: Portions;
  remaining: Portions;
}

const ZERO_PORTIONS: Portions = { staple: 0, meat: 0, fruit: 0, veg: 0 };

/**
 * Use case: a day's effective portion target (base + bonus) and remaining
 * portions (effective - sum of logged portions). Logged portions are the sum
 * of the consumed amount (per-unit x quantity, D3) across all of the day's
 * meal items; unclassified items carry zero portions, so they never reduce
 * remaining. Days without a set target carry forward the base from the most
 * recent earlier target (bonus 0); a day that has never had a target set,
 * directly or via carry-forward, reports a zero base/bonus.
 */
export async function getDailyTargetWithRemaining(
  dailyTargetRepository: DailyTargetRepository,
  mealRepository: MealRepository,
  userId: string,
  day: string,
): Promise<DailyTargetWithRemaining> {
  const exact = await dailyTargetRepository.get(userId, day);
  const carry = exact ? null : await dailyTargetRepository.getLatestOnOrBefore(userId, day);
  const base: Portions = exact
    ? { staple: exact.baseStaple, meat: exact.baseMeat, fruit: exact.baseFruit, veg: exact.baseVeg }
    : carry
      ? { staple: carry.baseStaple, meat: carry.baseMeat, fruit: carry.baseFruit, veg: carry.baseVeg }
      : ZERO_PORTIONS;
  const bonus: Portions = exact
    ? { staple: exact.bonusStaple, meat: exact.bonusMeat, fruit: exact.bonusFruit, veg: exact.bonusVeg }
    : ZERO_PORTIONS;
  const effective: Portions = {
    staple: base.staple + bonus.staple,
    meat: base.meat + bonus.meat,
    fruit: base.fruit + bonus.fruit,
    veg: base.veg + bonus.veg,
  };

  const meals = await mealRepository.listMealsByDay(userId, day);
  const logged = meals
    .flatMap((meal) => meal.items)
    .reduce<Portions>(
      (acc, item) => {
        const consumed = scaleByQuantity(item, item.quantity);
        return {
          staple: acc.staple + consumed.staple,
          meat: acc.meat + consumed.meat,
          fruit: acc.fruit + consumed.fruit,
          veg: acc.veg + consumed.veg,
        };
      },
      { ...ZERO_PORTIONS },
    );

  const remaining: Portions = {
    staple: effective.staple - logged.staple,
    meat: effective.meat - logged.meat,
    fruit: effective.fruit - logged.fruit,
    veg: effective.veg - logged.veg,
  };

  return { day, base, bonus, effective, logged, remaining };
}
