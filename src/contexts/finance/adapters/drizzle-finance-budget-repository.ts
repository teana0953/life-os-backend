import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { financeBudget, financeBudgetAlert, financeTransaction } from "../../../shared/db/schema";
import type { FinanceBudget, UpsertFinanceBudgetInput } from "../domain/finance-budget";
import type { BudgetWithSpent, FinanceBudgetRepository, TryRecordAlertInput } from "../domain/finance-budget-repository";

type FinanceBudgetRow = typeof financeBudget.$inferSelect;

function toDomain(row: FinanceBudgetRow): FinanceBudget {
  return { id: row.id, userId: row.userId, categoryId: row.categoryId, amount: row.amount };
}

/**
 * TWD expense sum for `userId` in `month`, scoped to `categoryId` (null =
 * every category) — `SUM(integer)` returns bigint over the wire (surfaced as
 * a string), so it's cast to number before returning (same pattern as
 * `DrizzleFinanceTransactionRepository.getMonthlySummaryRaw`).
 */
async function spentSum(db: Db, userId: string, categoryId: string | null, month: string): Promise<number> {
  const scopeFilter = categoryId === null ? sql`true` : sql`${financeTransaction.categoryId} = ${categoryId}`;
  const [row] = await db
    .select({ amount: sql<string | null>`SUM(${financeTransaction.amount})` })
    .from(financeTransaction)
    .where(
      and(
        eq(financeTransaction.userId, userId),
        eq(financeTransaction.type, "expense"),
        eq(financeTransaction.currency, "TWD"),
        sql`to_char(${financeTransaction.day}, 'YYYY-MM') = ${month}`,
        scopeFilter,
      ),
    );
  return row?.amount ? Number(row.amount) : 0;
}

export class DrizzleFinanceBudgetRepository implements FinanceBudgetRepository {
  constructor(private readonly getDb: () => Db) {}

  async upsert(input: UpsertFinanceBudgetInput): Promise<FinanceBudget> {
    const db = this.getDb();
    const values = { userId: input.userId, categoryId: input.categoryId, amount: input.amount };
    // The two partial unique indexes (design.md) need different conflict
    // targets depending on whether this is the overall (category_id null) or
    // a category budget — `targetWhere` selects the matching partial index.
    const [row] =
      input.categoryId === null
        ? await db
            .insert(financeBudget)
            .values(values)
            .onConflictDoUpdate({
              target: [financeBudget.userId],
              targetWhere: sql`category_id is null`,
              set: { amount: input.amount, updatedAt: new Date() },
            })
            .returning()
        : await db
            .insert(financeBudget)
            .values(values)
            .onConflictDoUpdate({
              target: [financeBudget.userId, financeBudget.categoryId],
              targetWhere: sql`category_id is not null`,
              set: { amount: input.amount, updatedAt: new Date() },
            })
            .returning();
    if (!row) throw new Error("failed to upsert finance budget");
    return toDomain(row);
  }

  async findByUserAndCategory(userId: string, categoryId: string | null): Promise<FinanceBudget | null> {
    const db = this.getDb();
    const categoryFilter = categoryId === null ? isNull(financeBudget.categoryId) : eq(financeBudget.categoryId, categoryId);
    const [row] = await db
      .select()
      .from(financeBudget)
      .where(and(eq(financeBudget.userId, userId), categoryFilter))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const db = this.getDb();
    const deleted = await db
      .delete(financeBudget)
      .where(and(eq(financeBudget.id, id), eq(financeBudget.userId, userId)))
      .returning({ id: financeBudget.id });
    return deleted.length > 0;
  }

  /**
   * One query for every budget's spent total, not one query per budget: the
   * overall budget (`category_id is null`) joins every matching transaction
   * regardless of category, a category budget joins only its own category —
   * `left join ... on (fb.category_id is null or ft.category_id = fb.category_id)`
   * captures both without a per-row branch. Query count must not grow with
   * budget count: the health/home batch endpoints share one Workers
   * subrequest budget across every section (batch-screen-reads design.md D6),
   * so an N+1 here is invisible in a test that stubs a single budget but
   * unbounded — and could itself blow the cap — in production.
   */
  async listWithSpent(userId: string, month: string): Promise<BudgetWithSpent[]> {
    const db = this.getDb();
    const rows = await db
      .select({
        budget: financeBudget,
        spent: sql<string | null>`sum(case when ${financeTransaction.id} is not null then ${financeTransaction.amount} else 0 end)`,
      })
      .from(financeBudget)
      .leftJoin(
        financeTransaction,
        and(
          eq(financeTransaction.userId, financeBudget.userId),
          eq(financeTransaction.type, "expense"),
          eq(financeTransaction.currency, "TWD"),
          sql`to_char(${financeTransaction.day}, 'YYYY-MM') = ${month}`,
          sql`(${financeBudget.categoryId} is null or ${financeTransaction.categoryId} = ${financeBudget.categoryId})`,
        ),
      )
      .where(eq(financeBudget.userId, userId))
      .groupBy(financeBudget.id);
    return rows.map((row) => ({ budget: toDomain(row.budget), spent: row.spent ? Number(row.spent) : 0 }));
  }

  async getSpent(userId: string, categoryId: string | null, month: string): Promise<number> {
    return spentSum(this.getDb(), userId, categoryId, month);
  }

  async tryRecordAlert(input: TryRecordAlertInput): Promise<boolean> {
    const db = this.getDb();
    const inserted = await db
      .insert(financeBudgetAlert)
      .values({ userId: input.userId, budgetId: input.budgetId, month: input.month, threshold: input.threshold })
      .onConflictDoNothing({ target: [financeBudgetAlert.budgetId, financeBudgetAlert.month, financeBudgetAlert.threshold] })
      .returning({ id: financeBudgetAlert.id });
    return inserted.length > 0;
  }
}
