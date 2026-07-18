import { portionsToNutrients, resolveKcal, type Portions } from "../domain/conversion";
import type { DietLogRepository } from "../domain/diet-log-repository";
import type { FoodEntry } from "../domain/food-entry";

interface ManualNutrientsInput {
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal?: number;
}

interface CommonInput {
  userId: string;
  day: string;
  meal: string;
  name?: string | null;
  photoRef?: string | null;
}

export type LogManualFoodEntryInput = CommonInput &
  ({ portions: Portions; nutrients?: undefined } | { nutrients: ManualNutrientsInput; portions?: undefined });

/**
 * Use case: log a manual food entry from either supplied portions (nutrients
 * are derived; classified) or supplied nutrients (stored as given; marked
 * unclassified since no food-group categorization was provided).
 */
export async function logManualFoodEntry(repository: DietLogRepository, input: LogManualFoodEntryInput): Promise<FoodEntry> {
  const base = {
    userId: input.userId,
    day: input.day,
    meal: input.meal,
    name: input.name ?? null,
    photoRef: input.photoRef ?? null,
    source: "manual" as const,
  };

  if (input.portions) {
    const nutrients = portionsToNutrients(input.portions);
    return repository.create({ ...base, unclassified: false, ...nutrients, ...input.portions });
  }

  const { carbG, proteinG, fatG, sugarG, fiberG, kcal } = input.nutrients;
  return repository.create({
    ...base,
    unclassified: true,
    carbG,
    proteinG,
    fatG,
    sugarG,
    fiberG,
    kcal: resolveKcal({ carbG, proteinG, fatG }, kcal),
    staple: 0,
    meat: 0,
    fruit: 0,
    veg: 0,
  });
}
