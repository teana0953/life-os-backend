import type { FoodEntry, FoodEntrySource } from "./food-entry";

export interface CreateFoodEntryInput {
  userId: string;
  day: string;
  meal: string;
  name: string | null;
  photoRef: string | null;
  source: FoodEntrySource;
  unclassified: boolean;
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal: number;
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
}

export interface DietLogRepository {
  create(input: CreateFoodEntryInput): Promise<FoodEntry>;
  listByDay(userId: string, day: string): Promise<FoodEntry[]>;
  /** Deletes the entry if owned by userId. Returns whether an entry was deleted. */
  delete(userId: string, entryId: string): Promise<boolean>;
}
