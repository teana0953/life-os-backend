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

/** Driven adapter: implements FinanceBudgetRepository via Drizzle + Neon. */
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

  async listWithSpent(userId: string, month: string): Promise<BudgetWithSpent[]> {
    const db = this.getDb();
    const rows = await db.select().from(financeBudget).where(eq(financeBudget.userId, userId));
    const result: BudgetWithSpent[] = [];
    for (const row of rows) {
      const budget = toDomain(row);
      const spent = await spentSum(db, userId, budget.categoryId, month);
      result.push({ budget, spent });
    }
    return result;
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
