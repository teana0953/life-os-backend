import type { DietLogRepository } from "../domain/diet-log-repository";
import type { FoodEntry } from "../domain/food-entry";

export interface MealGroup {
  meal: string;
  entries: FoodEntry[];
}

export interface DayNutrientTotals {
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal: number;
}

export interface DayDietLog {
  day: string;
  meals: MealGroup[];
  totals: DayNutrientTotals;
}

const ZERO_TOTALS: DayNutrientTotals = { carbG: 0, proteinG: 0, fatG: 0, sugarG: 0, fiberG: 0, kcal: 0 };

/**
 * Use case: a day's diet log, grouped by meal in chronological order, with
 * nutrient/calorie totals computed from atomic fields only (never portions).
 */
export async function getDayDietLog(repository: DietLogRepository, userId: string, day: string): Promise<DayDietLog> {
  const entries = [...(await repository.listByDay(userId, day))].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());

  const meals: MealGroup[] = [];
  const indexByMeal = new Map<string, number>();
  for (const entry of entries) {
    let index = indexByMeal.get(entry.meal);
    if (index === undefined) {
      index = meals.length;
      meals.push({ meal: entry.meal, entries: [] });
      indexByMeal.set(entry.meal, index);
    }
    meals[index]!.entries.push(entry);
  }

  const totals = entries.reduce<DayNutrientTotals>(
    (acc, e) => ({
      carbG: acc.carbG + e.carbG,
      proteinG: acc.proteinG + e.proteinG,
      fatG: acc.fatG + e.fatG,
      sugarG: acc.sugarG + e.sugarG,
      fiberG: acc.fiberG + e.fiberG,
      kcal: acc.kcal + e.kcal,
    }),
    ZERO_TOTALS,
  );

  return { day, meals, totals };
}
