export interface Friendship {
  id: string;
  /** Normalized pair: always the lexicographically smaller of the two ids. */
  userAId: string;
  userBId: string;
  createdAt: Date;
}

/**
 * Orders a pair for storage. The comparison basis is pinned to the **lowercase
 * canonical UUID string** (`8-4-4-4-12`): Postgres' `uuid` type compares byte
 * order and JS compares string order, and those two agree only in this form
 * (add-friends/design.md). The `CHECK (user_a_id < user_b_id)` constraint is
 * the DB-side backstop for the same invariant.
 */
export function normalizePair(userId: string, otherUserId: string): { userAId: string; userBId: string } {
  const one = userId.toLowerCase();
  const other = otherUserId.toLowerCase();
  return one < other ? { userAId: one, userBId: other } : { userAId: other, userBId: one };
}
