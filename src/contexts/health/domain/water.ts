export interface WaterIntake {
  userId: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  day: string;
  totalMl: number;
}

export interface WaterTarget {
  userId: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  day: string;
  targetMl: number;
}
