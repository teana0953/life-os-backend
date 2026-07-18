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
  /** Gram weight of one dictionary unit, used to convert a gram amount to a quantity; null when the unit has no defined gram weight. */
  baseGrams: number | null;
  createdAt: Date;
}
