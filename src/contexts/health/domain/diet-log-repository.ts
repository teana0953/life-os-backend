import type { Portions } from "./conversion";
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
  eatenAt: Date;
}

/** Partial update: only supplied fields change (D2 in design.md). */
export interface UpdateFoodEntryPatch {
  name?: string | null;
  meal?: string;
  eatenAt?: Date;
  portions?: Portions;
}

export interface DietLogRepository {
  create(input: CreateFoodEntryInput): Promise<FoodEntry>;
  listByDay(userId: string, day: string): Promise<FoodEntry[]>;
  /** Deletes the entry if owned by userId. Returns whether an entry was deleted. */
  delete(userId: string, entryId: string): Promise<boolean>;
  /**
   * Updates the entry if owned by userId, merging only supplied patch fields.
   * Supplying `portions` recomputes nutrients and clears `unclassified`;
   * supplying `eatenAt` also updates `day` to its calendar date (D1, D2).
   * Returns the updated entry, or null when not owned/found.
   */
  update(userId: string, entryId: string, patch: UpdateFoodEntryPatch): Promise<FoodEntry | null>;
  /** Distinct calendar days in `month` (YYYY-MM) on which the user has at least one entry, ascending. */
  listLoggedDays(userId: string, month: string): Promise<string[]>;
}
