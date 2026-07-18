export type FoodEntrySource = "manual" | "ai_photo" | "dict";

export interface FoodEntry {
  id: string;
  userId: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  day: string;
  meal: string;
  name: string | null;
  photoRef: string | null;
  source: FoodEntrySource;
  /** True for nutrient-only entries with no food-group classification (D1: never inferred from all-zero portions). */
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
  /** When the food was eaten; user-settable, defaults to creation time (D3). */
  eatenAt: Date;
  /** System audit time; never user-settable. */
  loggedAt: Date;
}
