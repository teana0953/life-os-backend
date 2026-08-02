import { InvalidSplitInput, SharesDoNotSumToAmount } from "./errors";
import type { SplitShareInput } from "./split-expense";

/** String order on the lowercase canonical UUID form — the only form where Postgres' `uuid` byte order and JS string order agree (mirrors `friendship`'s `normalizePair`). */
function compareCanonical(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  return 0;
}

/**
 * Splits `amount` (an integer, minor units) equally among `userIds` using
 * only integer arithmetic. The remainder (`amount % n` minor units, always
 * `0 <= rem < n`) is assigned one unit at a time to the participants ordered
 * by lowercase canonical UUID string, so the same amount and participant set
 * always produce the same split, however many times it is recomputed
 * (design.md).
 */
export function equalSplit(amount: number, userIds: string[]): SplitShareInput[] {
  const n = userIds.length;
  const base = Math.floor(amount / n);
  const remainder = amount % n;
  const ordered = [...userIds].sort(compareCanonical);
  return ordered.map((userId, index) => ({ userId, amount: base + (index < remainder ? 1 : 0) }));
}

/**
 * Validates a caller-supplied exact split: every share must be a
 * non-negative integer, and they must sum to `amount` exactly. Never
 * adjusts a share to make the total work — a short or long split is
 * rejected outright (design.md).
 */
export function validateExactSplit(amount: number, shares: SplitShareInput[]): void {
  for (const share of shares) {
    if (!Number.isInteger(share.amount) || share.amount < 0) {
      throw new InvalidSplitInput(`share amount must be a non-negative integer: ${share.amount}`);
    }
  }
  const sum = shares.reduce((total, share) => total + share.amount, 0);
  if (sum !== amount) throw new SharesDoNotSumToAmount(amount, sum);
}
