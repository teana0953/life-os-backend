import type { Portions } from "./conversion";
import type { MealEntry, MealItem, MealItemSource, MealSummary } from "./meal-entry";

export interface CreateMealItemInput {
  foodItemId: string | null;
  name: string | null;
  photoRef: string | null;
  source: MealItemSource;
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
  quantity: number;
  baseAmount: number | null;
  measureUnit: string | null;
}

export interface UpsertMealWithItemsInput {
  userId: string;
  day: string;
  meal: string;
  /** Used only when creating a new meal for this (user, day, meal); ignored when the meal already exists (D2). */
  time?: Date;
  items: CreateMealItemInput[];
}

/**
 * Partial update for a meal item (Model Y, D3): `quantity` and `measure` are
 * mutually exclusive ways to set the `quantity` column only (measure is
 * converted via the item's own stored `base_amount`, interpreted in its own
 * `measureUnit`); `portions` sets the per-unit portion columns and recomputes
 * per-unit nutrients, marking the item classified. None of these rescale the
 * stored per-unit values.
 */
export interface UpdateMealItemPatch {
  quantity?: number;
  measure?: number;
  portions?: Portions;
}

/** Port for meals and their items, replacing DietLogRepository (D6). */
export interface MealRepository {
  /** Creates the meal for (userId, day, meal) if absent (with `time` when given), or reuses it, then appends `items`. */
  upsertMealWithItems(input: UpsertMealWithItemsInput): Promise<MealEntry>;
  /** All of the user's meals on `day`, each with its items. */
  listMealsByDay(userId: string, day: string): Promise<MealEntry[]>;
  /** Distinct calendar days in `month` (YYYY-MM) on which the user has at least one meal, ascending. */
  listLoggedDays(userId: string, month: string): Promise<string[]>;
  /** Updates a meal's time if owned by userId; does not change `day`. Returns null if not owned/found. */
  updateMealTime(userId: string, mealId: string, time: Date): Promise<MealSummary | null>;
  /** Deletes a meal if owned by userId (cascades its items). Returns whether a meal was deleted. */
  deleteMeal(userId: string, mealId: string): Promise<boolean>;
  /** Updates an item if owned by userId (via its parent meal). Returns null if not owned/found. */
  updateItem(userId: string, itemId: string, patch: UpdateMealItemPatch): Promise<MealItem | null>;
  /** Deletes an item if owned by userId (via its parent meal). Returns whether an item was deleted. */
  deleteItem(userId: string, itemId: string): Promise<boolean>;
}
