export type MealItemSource = "manual" | "ai_photo" | "dict";

export interface MealItem {
  id: string;
  mealEntryId: string;
  /** Dictionary item this was logged from; null for manual/AI items (ON DELETE SET NULL, D3). */
  foodItemId: string | null;
  name: string | null;
  photoRef: string | null;
  source: MealItemSource;
  /** True for nutrient-only items with no food-group classification (D1: never inferred from all-zero portions). */
  unclassified: boolean;
  /** Per-unit atomic nutrients (the amount for quantity = 1); consumed = per-unit x quantity, derived on read (D3). */
  carbG: number;
  proteinG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  kcal: number;
  /** Per-unit food-group portions (the amount for quantity = 1); consumed = per-unit x quantity, derived on read (D3). */
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
  /** Multiplier; the stored per-unit values are never rescaled when only quantity changes (D3). */
  quantity: number;
  /** Amount of one unit in `measureUnit`, copied from the dictionary item at add time; both null when not directly measurable. */
  baseAmount: number | null;
  /** Unit `baseAmount` is expressed in: any open string ('g', 'ml', or a household quantifier word e.g. '顆'); null iff baseAmount is null. */
  measureUnit: string | null;
  createdAt: Date;
}

export interface MealSummary {
  id: string;
  userId: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  day: string;
  meal: string;
  /** When the meal was eaten; user-settable, defaults to creation time. Editing does not move `day` (D2). */
  time: Date;
  createdAt: Date;
}

export interface MealEntry extends MealSummary {
  items: MealItem[];
}
