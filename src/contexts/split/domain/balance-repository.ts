import type { Balance } from "./balance";

export interface BalanceRepository {
  /**
   * `userId`'s net against every other person they have a shared expense
   * with (grouped or groupless alike), per currency. Aggregated in the
   * database, not by loading every share into memory (design.md).
   */
  /**
   * [today] is the caller's own local date (`YYYY-MM-DD`), resolved by the
   * application layer from `users.timezone` — the query must not work it out
   * itself. `CURRENT_DATE` is the database session's date, and the one
   * spelling that looks like a fix, `CURRENT_DATE AT TIME ZONE tz`, means
   * "today's midnight read as a wall clock over there" and yields a
   * *timestamp* that then compares against a `date` by implicit cast: no
   * error, just a wrong answer for the eight hours a Taipei user is a day
   * ahead of UTC. Passing the date in is also what makes it testable at all.
   */
  balancesForUser(userId: string, today: string): Promise<Balance[]>;
  /**
   * Every member of `groupId`'s net against the whole group (not a pairwise
   * matrix), scoped to that group's expenses only. Sums to zero per currency
   * (design.md invariant) — this holds only because a grouped expense's
   * payer is always a group member (enforced at write time).
   */
  balancesForGroup(groupId: string): Promise<Balance[]>;
}
