import type { DailyTarget } from "./daily-target";

export interface SetDailyTargetInput {
  userId: string;
  day: string;
  baseStaple: number;
  baseMeat: number;
  baseFruit: number;
  baseVeg: number;
  bonusStaple?: number;
  bonusMeat?: number;
  bonusFruit?: number;
  bonusVeg?: number;
}

export interface DailyTargetRepository {
  get(userId: string, day: string): Promise<DailyTarget | null>;
  /** Most recent target with day <= the given day, or null if none. */
  getLatestOnOrBefore(userId: string, day: string): Promise<DailyTarget | null>;
  /** Targets with day in `[from, to]`, ascending by day. */
  listInRange(userId: string, from: string, to: string): Promise<DailyTarget[]>;
  /** Upsert semantics, keyed by (userId, day). */
  set(input: SetDailyTargetInput): Promise<DailyTarget>;
  /** Same semantics as `set`, for all `rows` in one batched write. Empty input is a no-op. */
  setMany(rows: SetDailyTargetInput[]): Promise<void>;
}
