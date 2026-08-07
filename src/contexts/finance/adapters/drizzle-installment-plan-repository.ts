import { and, asc, eq, gt } from "drizzle-orm";
import { financeTransactionRowToDomain } from "./drizzle-finance-transaction-repository";
import type { FinanceTransaction } from "../domain/finance-transaction";
import type {
  CreateInstallmentPlanRecord,
  InstallmentPlan,
  InstallmentPlanMode,
  InstallmentRow,
  InstallmentSettlementRow,
} from "../domain/installment-plan";
import type { InstallmentPlanRepository } from "../domain/installment-plan-repository";
import { financeInstallmentPlan, financeTransaction } from "../../../shared/db/schema";
import type { Db } from "../../../shared/db/client";

type FinanceInstallmentPlanRow = typeof financeInstallmentPlan.$inferSelect;

function toDomain(row: FinanceInstallmentPlanRow): InstallmentPlan {
  return {
    id: row.id,
    userId: row.userId,
    mode: row.mode as InstallmentPlanMode,
    periods: row.periods,
    startDay: row.startDay,
    amount: row.amount,
    currency: row.currency,
    categoryId: row.categoryId,
    note: row.note,
  };
}

function installmentRowValues(userId: string, planId: string, currency: string, categoryId: string, note: string | null, rows: InstallmentRow[]) {
  return rows.map((row) => ({
    userId,
    type: "expense" as const,
    amount: row.amount,
    currency,
    categoryId,
    day: row.day,
    note,
    planId,
    installmentNo: row.installmentNo,
  }));
}

/**
 * Driven adapter: implements `InstallmentPlanRepository` via Drizzle + Neon
 * (add-installments design.md D2/D3b/D6). The statement-count contract this
 * port pins down — one multi-row INSERT to create, one user-scoped
 * `DELETE ... WHERE user_id = ? AND plan_id = ? AND day > ?` to clear — is
 * verified directly by `test/db/installments.test.ts` via an `onQuery` hook,
 * because neon-http's `db.batch` statement limit cannot be found anywhere
 * (driver source, docs, Neon's own docs — all silent, D3b).
 */
export class DrizzleInstallmentPlanRepository implements InstallmentPlanRepository {
  // eslint-disable-next-line no-useless-constructor -- kept as a plain `db: Db` (not `getDb: () => Db` like every other repository here) because `test/db/installments.test.ts` constructs it directly against a PGlite instance; the composition root supplies a lazily-evaluated `Db` proxy instead.
  constructor(protected readonly db: Db) {}

  /**
   * The plan id is generated here, up front — the same reason
   * `DrizzleExpenseGroupRepository.create` does: neon-http's `db.batch`
   * cannot chain a DB-generated id from one statement into the next, and the
   * instalment rows' `plan_id` must be known before the batch is sent.
   */
  async createWithInstallments(plan: CreateInstallmentPlanRecord, rows: InstallmentRow[]): Promise<InstallmentPlan> {
    const id = crypto.randomUUID();
    const now = new Date();
    const planInsert = this.db.insert(financeInstallmentPlan).values({
      id,
      userId: plan.userId,
      mode: plan.mode,
      periods: plan.periods,
      startDay: plan.startDay,
      amount: plan.amount,
      currency: plan.currency,
      categoryId: plan.categoryId,
      note: plan.note ?? null,
      createdAt: now,
      updatedAt: now,
    });
    // ONE multi-row INSERT for every instalment, whatever the period count
    // (D3b) — never one statement per instalment.
    const transactionsInsert = this.db
      .insert(financeTransaction)
      .values(installmentRowValues(plan.userId, id, plan.currency, plan.categoryId, plan.note ?? null, rows));
    await this.db.batch([planInsert, transactionsInsert]);

    return {
      id,
      userId: plan.userId,
      mode: plan.mode,
      periods: plan.periods,
      startDay: plan.startDay,
      amount: plan.amount,
      currency: plan.currency,
      categoryId: plan.categoryId,
      note: plan.note ?? null,
    };
  }

  async findById(id: string): Promise<InstallmentPlan | null> {
    const [row] = await this.db.select().from(financeInstallmentPlan).where(eq(financeInstallmentPlan.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async listInstallments(userId: string, planId: string): Promise<FinanceTransaction[]> {
    const rows = await this.db
      .select()
      .from(financeTransaction)
      .where(and(eq(financeTransaction.userId, userId), eq(financeTransaction.planId, planId)))
      .orderBy(asc(financeTransaction.day));
    return rows.map(financeTransactionRowToDomain);
  }

  async rewriteUpcoming(userId: string, planId: string, afterDay: string, rows: InstallmentRow[]): Promise<void> {
    const plan = await this.findById(planId);
    if (!plan) return;
    const deleteStmt = this.db
      .delete(financeTransaction)
      .where(and(eq(financeTransaction.userId, userId), eq(financeTransaction.planId, planId), gt(financeTransaction.day, afterDay)));
    const insertStmt = this.db
      .insert(financeTransaction)
      .values(installmentRowValues(userId, planId, plan.currency, plan.categoryId, plan.note, rows));
    await this.db.batch([deleteStmt, insertStmt]);
  }

  async settle(userId: string, planId: string, afterDay: string, settlement: InstallmentSettlementRow): Promise<void> {
    const deleteStmt = this.db
      .delete(financeTransaction)
      .where(and(eq(financeTransaction.userId, userId), eq(financeTransaction.planId, planId), gt(financeTransaction.day, afterDay)));
    const insertStmt = this.db.insert(financeTransaction).values({
      userId,
      type: "expense",
      amount: settlement.amount,
      currency: settlement.currency,
      categoryId: settlement.categoryId,
      day: settlement.day,
      note: settlement.note ?? null,
      planId,
      // Not "the Nth of N" — an out-of-band payoff — so it is deliberately
      // left unnumbered rather than reusing or inventing an instalment number
      // (design.md D6, tasks 5.3).
      installmentNo: null,
    });
    await this.db.batch([deleteStmt, insertStmt]);
  }
}
