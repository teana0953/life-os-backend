import type { WaterIntake, WaterTarget } from "./water";

export interface SetWaterTargetInput {
  userId: string;
  day: string;
  targetMl: number;
}

export interface WaterRepository {
  getIntake(userId: string, day: string): Promise<WaterIntake | null>;
  /** Adds to the day's total, clamped at 0 (a negative amount corrects an over-count). */
  addIntake(userId: string, day: string, addMl: number): Promise<WaterIntake>;
  getTarget(userId: string, day: string): Promise<WaterTarget | null>;
  /** Most recent target with day <= the given day, or null if none. */
  getLatestTargetOnOrBefore(userId: string, day: string): Promise<WaterTarget | null>;
  /** Upsert semantics, keyed by (userId, day). */
  setTarget(input: SetWaterTargetInput): Promise<WaterTarget>;
}
