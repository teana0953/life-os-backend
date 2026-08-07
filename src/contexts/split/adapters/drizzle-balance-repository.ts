import { sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import type { Balance, CurrencyBalance } from "../domain/balance";
import type { BalanceRepository } from "../domain/balance-repository";
import { splitDisplayName } from "../domain/display-name";
// personalSettlementDelta / groupSettlementDelta are the single written
// source of truth for the signs below (settlement-balance.ts) — every
// settlement UNION ALL leg here must carry a comment naming which function it
// transcribes. This SQL **is** executed in CI: `test/db/balances.test.ts`
// runs it against a real Postgres (PGlite) with this repo's migrations, and
// every settlement leg's sign, currency column and group scope was shown to
// redden a test when made wrong. Still unproven there: the write paths
// (`db.batch` has no PGlite equivalent) and anything at the connection layer
// — see `test/db/harness.ts` for the full boundary.

type NetRow = {
  counterpart_id: string;
  display_name: string | null;
  email: string;
  currency: string;
  net: string;
};

type ProgressRow = {
  counterpart_id: string;
  currency: string;
  total_periods: number;
  period_amount: number;
  due_periods: number;
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

/** `attachSchedule`'s lookup key — counterpart and currency, the same grain a `CurrencyBalance` entry is at. */
function progressKey(counterpartId: string, currency: string): string {
  return `${counterpartId}:${currency}`;
}

/**
 * Mutates `balances` in place, attaching each `CurrencyBalance` entry's
 * schedule progress when `progressRows` has one for that (counterpart,
 * currency) pair — absent otherwise, never zeroed (split-installments tasks
 * 4.1/4.2).
 */
function attachSchedules(balances: Balance[], progressRows: ProgressRow[]): void {
  if (progressRows.length === 0) return;
  const byKey = new Map(progressRows.map((row) => [progressKey(row.counterpart_id, row.currency), row]));
  for (const balance of balances) {
    for (const currencyBalance of balance.balances) {
      const progress = byKey.get(progressKey(balance.userId, currencyBalance.currency));
      if (!progress) continue;
      currencyBalance.schedule = {
        nextPeriod: Math.min(progress.due_periods + 1, progress.total_periods),
        totalPeriods: progress.total_periods,
        periodAmount: progress.period_amount,
      };
    }
  }
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
        -- personalSettlementDelta: row keyed by the counterpart (from_user_id
        -- here); a settlement FROM the counterpart TO me pays off what they
        -- owe, so it SUBTRACTS from "counterpart owes me". No group_id filter
        -- — this balance nets grouped and groupless expenses alike, so its
        -- settlement legs must too (design.md).
        UNION ALL
        SELECT s.from_user_id AS counterpart_id, s.currency AS currency, -s.amount AS signed_amount
          FROM split_settlement s
         WHERE s.to_user_id = ${me}::uuid
        -- personalSettlementDelta: row keyed by the counterpart (to_user_id
        -- here); a settlement FROM me TO the counterpart pays off what I owe
        -- them, so it ADDS (moves the net away from "I owe them").
        UNION ALL
        SELECT s.to_user_id AS counterpart_id, s.currency AS currency, s.amount AS signed_amount
          FROM split_settlement s
         WHERE s.from_user_id = ${me}::uuid
      )
      SELECT net.counterpart_id AS counterpart_id, u.display_name AS display_name, u.email AS email, net.currency AS currency, SUM(net.signed_amount) AS net
        FROM net
        JOIN users u ON u.id = net.counterpart_id
       GROUP BY net.counterpart_id, u.display_name, u.email, net.currency
      HAVING SUM(net.signed_amount) != 0
    `);
    const balances = rowsToBalances(result.rows);
    attachSchedules(balances, await this.scheduleProgressForUser(me));
    return balances;
  }

  /**
   * Repayment-schedule progress for every (counterpart, currency) pair
   * `me` has a scheduled share in, either direction (split-installments
   * tasks 4.1–4.3). A mirror row is "on a schedule" when its
   * `installment_no` is not null (`FinanceSharesMirror.plan`'s condition
   * inversion never leaves one on an ordinary lump row). Deliberately
   * calendar-based, not settlement-based: "which period is next" is a
   * question about the schedule's own dates, answered by `ft.day`, never by
   * `split_settlement` — a period's date arriving is not a repayment, and
   * counting it as one would double as the exact mistake `balancesForUser`'s
   * `net` CTE above refuses to make (design.md, spec `finance-ledger`
   * "A scheduled period is not a repayment").
   *
   * Grouped by (counterpart, currency) rather than by expense: this repo's
   * feature set never gives one counterpart two live schedules in the same
   * currency, so the ambiguity that grouping would hide never arises here.
   */
  private async scheduleProgressForUser(me: string): Promise<ProgressRow[]> {
    const result = await this.getDb().execute<ProgressRow>(sql`
      SELECT
        CASE WHEN se.payer_user_id = ${me}::uuid THEN ft.user_id ELSE se.payer_user_id END AS counterpart_id,
        ft.currency AS currency,
        COUNT(*)::int AS total_periods,
        MAX(ft.amount)::int AS period_amount,
        COUNT(*) FILTER (WHERE ft.day <= CURRENT_DATE)::int AS due_periods
        FROM finance_transaction ft
        JOIN split_expense se ON se.id = ft.split_expense_id
       WHERE ft.installment_no IS NOT NULL
         AND ((se.payer_user_id = ${me}::uuid AND ft.user_id != ${me}::uuid)
           OR (ft.user_id = ${me}::uuid AND se.payer_user_id != ${me}::uuid))
       GROUP BY counterpart_id, ft.currency
    `);
    return result.rows;
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
        -- groupSettlementDelta: row keyed by the member themselves — a member
        -- who is the settlement's sender reduces what they owe the group, so
        -- it ADDS (moves their own figure up, toward creditor). Only this
        -- group's settlements count (unlike the personal query above).
        UNION ALL
        SELECT s.from_user_id AS counterpart_id, s.currency AS currency, s.amount AS signed_amount
          FROM split_settlement s
         WHERE s.group_id = ${groupId}::uuid
        -- groupSettlementDelta: a member who is the settlement's recipient
        -- reduces what they are owed, so it SUBTRACTS.
        UNION ALL
        SELECT s.to_user_id AS counterpart_id, s.currency AS currency, -s.amount AS signed_amount
          FROM split_settlement s
         WHERE s.group_id = ${groupId}::uuid
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
