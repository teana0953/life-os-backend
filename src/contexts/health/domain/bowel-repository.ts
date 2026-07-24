import type { BowelLog } from "./bowel";

export interface SetBowelLogInput {
  userId: string;
  day: string;
  count: number;
  isNormal: boolean | null;
  note: string;
}

export interface BowelRepository {
  get(userId: string, day: string): Promise<BowelLog | null>;
  /** Upsert semantics, keyed by (userId, day). */
  set(input: SetBowelLogInput): Promise<BowelLog>;
  /** Upsert semantics, keyed by (userId, day), for all `rows` in one batched write. Empty input is a no-op. */
  setMany(rows: SetBowelLogInput[]): Promise<void>;
  /** The user's logs with day in `[from, to]` (inclusive). */
  listRange(userId: string, from: string, to: string): Promise<BowelLog[]>;
}
