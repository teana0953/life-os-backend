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
  /** Same semantics as `addIntake`, for all `rows` in one batched write. Empty input is a no-op. */
  addIntakeMany(rows: { userId: string; day: string; addMl: number }[]): Promise<void>;
  /** The user's intake with day in `[from, to]` (inclusive). */
  listIntakeRange(userId: string, from: string, to: string): Promise<WaterIntake[]>;
  getTarget(userId: string, day: string): Promise<WaterTarget | null>;
  /** Most recent target with day <= the given day, or null if none. */
  getLatestTargetOnOrBefore(userId: string, day: string): Promise<WaterTarget | null>;
  /** The user's targets with day in `[from, to]` (inclusive), ascending by day. */
  listTargetRange(userId: string, from: string, to: string): Promise<WaterTarget[]>;
  /** Upsert semantics, keyed by (userId, day). */
  setTarget(input: SetWaterTargetInput): Promise<WaterTarget>;
  /** Same semantics as `setTarget`, for all `rows` in one batched write. Empty input is a no-op. */
  setTargetMany(rows: SetWaterTargetInput[]): Promise<void>;
}
