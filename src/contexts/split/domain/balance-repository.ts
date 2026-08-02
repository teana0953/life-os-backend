import type { Balance } from "./balance";

export interface BalanceRepository {
  /**
   * `userId`'s net against every other person they have a shared expense
   * with (grouped or groupless alike), per currency. Aggregated in the
   * database, not by loading every share into memory (design.md).
   */
  balancesForUser(userId: string): Promise<Balance[]>;
  /**
   * Every member of `groupId`'s net against the whole group (not a pairwise
   * matrix), scoped to that group's expenses only. Sums to zero per currency
   * (design.md invariant) — this holds only because a grouped expense's
   * payer is always a group member (enforced at write time).
   */
  balancesForGroup(groupId: string): Promise<Balance[]>;
}
