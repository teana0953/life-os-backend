import type { MealEntry, MealItem } from "../domain/meal-entry";
import type { MealRepository } from "../domain/meal-repository";
import { scaleByQuantity, type Scalable } from "../domain/quantity";

export interface MealItemView extends MealItem {
  /** per-unit x quantity, derived for display (D3, D5). */
  consumed: Scalable;
}

export interface MealView {
  id: string;
  meal: string;
  time: Date;
  items: MealItemView[];
}

export interface DayNutrientTotals {
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal: number;
}

export interface DayPortionTotals {
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
}

export interface DayMealsLog {
  day: string;
  meals: MealView[];
  totals: { nutrients: DayNutrientTotals; portions: DayPortionTotals };
}

const ZERO_NUTRIENTS: DayNutrientTotals = { carbG: 0, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 0 };
const ZERO_PORTIONS: DayPortionTotals = { staple: 0, meat: 0, fruit: 0, veg: 0 };

function addNutrients(acc: DayNutrientTotals, item: Scalable): DayNutrientTotals {
  return {
    carbG: acc.carbG + item.carbG,
    proteinG: acc.proteinG + item.proteinG,
    fatG: acc.fatG + item.fatG,
    sugarG: acc.sugarG + item.sugarG,
    fiberG: acc.fiberG + item.fiberG,
    kcal: acc.kcal + item.kcal,
  };
}

function addPortions(acc: DayPortionTotals, item: Scalable): DayPortionTotals {
  return {
    staple: acc.staple + item.staple,
    meat: acc.meat + item.meat,
    fruit: acc.fruit + item.fruit,
    veg: acc.veg + item.veg,
  };
}

/**
 * Use case: a day's meals ordered by time, each with its items (per-unit +
 * quantity + the derived consumed amount), plus per-day nutrient and portion
 * totals summed as the consumed amount (per-unit x quantity) across all
 * items (D5). Replaces getDayDietLog.
 */
export async function getDayMeals(repository: MealRepository, userId: string, day: string): Promise<DayMealsLog> {
  const meals: MealEntry[] = [...(await repository.listMealsByDay(userId, day))].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );

  let nutrients = ZERO_NUTRIENTS;
  let portions = ZERO_PORTIONS;

  const mealViews: MealView[] = meals.map((meal) => {
    const items: MealItemView[] = meal.items.map((item) => {
      const consumed = scaleByQuantity(item, item.quantity);
      nutrients = addNutrients(nutrients, consumed);
      portions = addPortions(portions, consumed);
      return { ...item, consumed };
    });
    return { id: meal.id, meal: meal.meal, time: meal.time, items };
  });

  return { day, meals: mealViews, totals: { nutrients, portions } };
}
