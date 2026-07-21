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
}
