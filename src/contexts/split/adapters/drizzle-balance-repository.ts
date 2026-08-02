import { sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import type { Balance, CurrencyBalance } from "../domain/balance";
import type { BalanceRepository } from "../domain/balance-repository";
import { splitDisplayName } from "../domain/display-name";

type NetRow = {
  counterpart_id: string;
  display_name: string | null;
  email: string;
  currency: string;
  net: string;
};

/** Groups the SQL's already-netted, already-non-zero rows into the outward `Balance[]` shape, one entry per counterpart. */
function rowsToBalances(rows: NetRow[]): Balance[] {
  const byUser = new Map<string, { displayName: string; balances: CurrencyBalance[] }>();
  for (const row of rows) {
    let entry = byUser.get(row.counterpart_id);
    if (!entry) {
      entry = { displayName: splitDisplayName(row.display_name, row.email), balances: [] };
      byUser.set(row.counterpart_id, entry);
    }
    entry.balances.push({ currency: row.currency, amount: Number(row.net) });
  }
  return [...byUser.entries()].map(([userId, entry]) => ({ userId, displayName: entry.displayName, balances: entry.balances }));
}

/**
 * Driven adapter: implements BalanceRepository via Drizzle + Neon.
 *
 * Both queries follow the same shape: a `net` CTE unions one signed row per
 * (counterpart, currency, share), then a single `GROUP BY` sums and a
 * `HAVING` drops anything that nets to zero — aggregated entirely in
 * Postgres, never by loading shares into memory (design.md). Every branch
 * explicitly excludes the payer's own share (`ss.user_id != ...payer...`),
 * which is what keeps a payer from ever owing themselves.
 */
export class DrizzleBalanceRepository implements BalanceRepository {
  constructor(private readonly getDb: () => Db) {}

  /**
   * `userId`'s net against every other person they share an expense with.
   * "X owes me": expenses I paid, X's share. "I owe X": expenses X paid, my
   * share. Grouped and netted per currency; currencies that cancel out (or
   * pairs with none at all) never appear.
   */
  async balancesForUser(userId: string): Promise<Balance[]> {
    const me = userId.toLowerCase();
    const result = await this.getDb().execute<NetRow>(sql`
      WITH net AS (
        SELECT ss.user_id AS counterpart_id, se.currency AS currency, ss.amount AS signed_amount
          FROM split_share ss
          JOIN split_expense se ON se.id = ss.expense_id
         WHERE se.payer_user_id = ${me}::uuid AND ss.user_id != ${me}::uuid
        UNION ALL
        SELECT se.payer_user_id AS counterpart_id, se.currency AS currency, -ss.amount AS signed_amount
          FROM split_share ss
          JOIN split_expense se ON se.id = ss.expense_id
         WHERE ss.user_id = ${me}::uuid AND se.payer_user_id != ${me}::uuid
      )
      SELECT net.counterpart_id AS counterpart_id, u.display_name AS display_name, u.email AS email, net.currency AS currency, SUM(net.signed_amount) AS net
        FROM net
        JOIN users u ON u.id = net.counterpart_id
       GROUP BY net.counterpart_id, u.display_name, u.email, net.currency
      HAVING SUM(net.signed_amount) != 0
    `);
    return rowsToBalances(result.rows);
  }

  /**
   * Every member of `groupId`'s net against the whole group, scoped to that
   * group's expenses only (design.md: not a pairwise matrix — each member's
   * figure is against the group as a whole, so summing across members nets to
   * zero per currency, given a grouped expense's payer is always a member).
   */
  async balancesForGroup(groupId: string): Promise<Balance[]> {
    const result = await this.getDb().execute<NetRow>(sql`
      WITH net AS (
        SELECT se.payer_user_id AS counterpart_id, se.currency AS currency, ss.amount AS signed_amount
          FROM split_share ss
          JOIN split_expense se ON se.id = ss.expense_id
         WHERE se.group_id = ${groupId}::uuid AND ss.user_id != se.payer_user_id
        UNION ALL
        SELECT ss.user_id AS counterpart_id, se.currency AS currency, -ss.amount AS signed_amount
          FROM split_share ss
          JOIN split_expense se ON se.id = ss.expense_id
         WHERE se.group_id = ${groupId}::uuid AND ss.user_id != se.payer_user_id
      )
      SELECT net.counterpart_id AS counterpart_id, u.display_name AS display_name, u.email AS email, net.currency AS currency, SUM(net.signed_amount) AS net
        FROM net
        JOIN users u ON u.id = net.counterpart_id
       GROUP BY net.counterpart_id, u.display_name, u.email, net.currency
      HAVING SUM(net.signed_amount) != 0
    `);
    return rowsToBalances(result.rows);
  }
}
