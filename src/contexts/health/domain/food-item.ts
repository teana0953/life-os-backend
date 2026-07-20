export interface FoodItem {
  id: string;
  /** null for shared (seeded) items, visible to all users; set for a user's custom item. */
  ownerUserId: string | null;
  name: string;
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
  /** Amount of one dictionary unit in `measureUnit`, used to convert a measure amount to a quantity; both null when the unit has no defined measure basis (household unit). */
  baseAmount: number | null;
  /** Unit `baseAmount` is expressed in ('g' or 'ml'); null iff baseAmount is null. */
  measureUnit: "g" | "ml" | null;
  createdAt: Date;
}
