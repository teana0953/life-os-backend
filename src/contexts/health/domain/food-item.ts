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
  /** Amount of one dictionary unit in `measureUnit`, used to convert a measure amount to a quantity; both null when the unit has no structured measure basis (a fraction, vague size, packaging count, or `份`). */
  baseAmount: number | null;
  /** Unit `baseAmount` is expressed in: any open string ('g', 'ml', or a household quantifier word e.g. '顆'); null iff baseAmount is null. */
  measureUnit: string | null;
  createdAt: Date;
}
