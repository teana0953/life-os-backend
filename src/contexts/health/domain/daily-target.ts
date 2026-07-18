export interface DailyTarget {
  id: string;
  userId: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  day: string;
  baseStaple: number;
  baseMeat: number;
  baseFruit: number;
  baseVeg: number;
  bonusStaple: number;
  bonusMeat: number;
  bonusFruit: number;
  bonusVeg: number;
}
