import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { financeTransaction } from "../../../shared/db/schema";
import type { FinanceCategoryType } from "../domain/finance-category";
import type { CreateFinanceTransactionInput, FinanceCategorySource, FinanceTransaction, ReplaceFinanceTransactionInput } from "../domain/finance-transaction";
import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";
import type { MonthlySummaryRaw } from "../domain/monthly-summary";

type FinanceTransactionRow = typeof financeTransaction.$inferSelect;

function toDomain(row: FinanceTransactionRow): FinanceTransaction {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as FinanceCategoryType,
    amount: row.amount,
    currency: row.currency,
    categoryId: row.categoryId,
    date: row.day,
    note: row.note,
    splitExpenseId: row.splitExpenseId,
    categorySource: row.categorySource as FinanceCategorySource,
  };
}

/** Driven adapter: implements FinanceTransactionRepository via Drizzle + Neon. */
export class DrizzleFinanceTransactionRepository implements FinanceTransactionRepository {
  constructor(private readonly getDb: () => Db) {}

  async create(input: CreateFinanceTransactionInput): Promise<FinanceTransaction> {
    const db = this.getDb();
    const [row] = await db
      .insert(financeTransaction)
      .values({
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        categoryId: input.categoryId,
        day: input.date,
        note: input.note ?? null,
        splitExpenseId: input.splitExpenseId ?? null,
        categorySource: input.categorySource ?? "manual",
      })
      .returning();
    if (!row) throw new Error("failed to create finance transaction");
    return toDomain(row);
  }

  async findById(id: string): Promise<FinanceTransaction | null> {
    const db = this.getDb();
    const [row] = await db.select().from(financeTransaction).where(eq(financeTransaction.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async listByUserAndRange(userId: string, from: string, to: string): Promise<FinanceTransaction[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(financeTransaction)
      .where(and(eq(financeTransaction.userId, userId), gte(financeTransaction.day, from), lte(financeTransaction.day, to)))
      .orderBy(asc(financeTransaction.day));
    return rows.map(toDomain);
  }

  async update(userId: string, id: string, input: ReplaceFinanceTransactionInput): Promise<FinanceTransaction | null> {
    const db = this.getDb();
    // `updatedAt` has `defaultNow()` but that only fires on insert; every
    // update sets it explicitly. `splitExpenseId` and `categorySource` are
    // absent from the SET list on purpose: a full-replace update must not be
    // able to unlink a mirror from its split (design.md D17).
    const [row] = await db
      .update(financeTransaction)
      .set({
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        categoryId: input.categoryId,
        day: input.date,
        note: input.note ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(financeTransaction.id, id), eq(financeTransaction.userId, userId)))
      .returning();
    return row ? toDomain(row) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const db = this.getDb();
    const deleted = await db
      .delete(financeTransaction)
      .where(and(eq(financeTransaction.id, id), eq(financeTransaction.userId, userId)))
      .returning({ id: financeTransaction.id });
    return deleted.length > 0;
  }

  async getMonthlySummaryRaw(userId: string, month: string): Promise<MonthlySummaryRaw> {
    const db = this.getDb();
    // `day` is a `date` column; `to_char(day, 'YYYY-MM') = month` scopes to the
    // requested calendar month without pulling every transaction into memory.
    const monthFilter = and(eq(financeTransaction.userId, userId), sql`to_char(${financeTransaction.day}, 'YYYY-MM') = ${month}`);

    // pg's SUM(integer) returns bigint, which node-postgres/neon surfaces as a
    // string — cast to number before returning (design.md).
    const totalsRows = await db
      .select({
        currency: financeTransaction.currency,
        type: financeTransaction.type,
        amount: sql<string>`SUM(${financeTransaction.amount})`,
      })
      .from(financeTransaction)
      .where(monthFilter)
      .groupBy(financeTransaction.currency, financeTransaction.type);

    const byCategoryRows = await db
      .select({
        categoryId: financeTransaction.categoryId,
        type: financeTransaction.type,
        currency: financeTransaction.currency,
        amount: sql<string>`SUM(${financeTransaction.amount})`,
      })
      .from(financeTransaction)
      .where(monthFilter)
      .groupBy(financeTransaction.categoryId, financeTransaction.type, financeTransaction.currency);

    return {
      totals: totalsRows.map((r) => ({ currency: r.currency, type: r.type as FinanceCategoryType, amount: Number(r.amount) })),
      byCategory: byCategoryRows.map((r) => ({
        categoryId: r.categoryId,
        type: r.type as FinanceCategoryType,
        currency: r.currency,
        amount: Number(r.amount),
      })),
    };
  }
}
