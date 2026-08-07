import type { FinanceTransaction } from "../../../src/contexts/finance/domain/finance-transaction";
import type {
  CreateInstallmentPlanRecord,
  InstallmentPlan,
  InstallmentRow,
  InstallmentSettlementRow,
} from "../../../src/contexts/finance/domain/installment-plan";
import type { InstallmentPlanRepository } from "../../../src/contexts/finance/domain/installment-plan-repository";
import type { InMemoryFinanceTransactionRepository } from "./fakes";

/**
 * In-memory fake for the instalment-plan port, layered over the transactions
 * fake the same way `InMemoryFinanceBudgetRepository` is. It mirrors the SQL
 * semantics the port pins down (design.md D3b/D6) without a database:
 *
 * - instalments are ordinary rows in the transactions fake, carrying
 *   `planId`/`installmentNo`;
 * - "upcoming" is `day > afterDay`, STRICTLY — today's instalment has fallen
 *   due (D5);
 * - every mutation is scoped by BOTH `userId` and `planId`, like the real
 *   `DELETE WHERE user_id = ? AND plan_id = ? AND day > ?`;
 * - `listInstallments` returns only the rows that still exist — a deleted
 *   instalment is gone from every later computation (D2b).
 */
export class InMemoryInstallmentPlanRepository implements InstallmentPlanRepository {
  plans: InstallmentPlan[] = [];
  private nextId = 1;

  constructor(private readonly transactions: InMemoryFinanceTransactionRepository) {}

  async createWithInstallments(plan: CreateInstallmentPlanRecord, rows: InstallmentRow[]): Promise<InstallmentPlan> {
    const created: InstallmentPlan = {
      id: `plan-${this.nextId++}`,
      userId: plan.userId,
      mode: plan.mode,
      periods: plan.periods,
      startDay: plan.startDay,
      amount: plan.amount,
      currency: plan.currency,
      categoryId: plan.categoryId,
      note: plan.note ?? null,
    };
    this.plans.push(created);
    for (const row of rows) {
      await this.transactions.create({
        userId: plan.userId,
        type: "expense",
        amount: row.amount,
        currency: plan.currency,
        categoryId: plan.categoryId,
        date: row.day,
        note: plan.note ?? null,
        planId: created.id,
        installmentNo: row.installmentNo,
      });
    }
    return created;
  }

  async findById(id: string): Promise<InstallmentPlan | null> {
    return this.plans.find((p) => p.id === id) ?? null;
  }

  async listInstallments(userId: string, planId: string): Promise<FinanceTransaction[]> {
    return this.transactions.transactions.filter((t) => t.userId === userId && t.planId === planId).sort((a, b) => a.date.localeCompare(b.date));
  }

  async rewriteUpcoming(userId: string, planId: string, afterDay: string, rows: InstallmentRow[]): Promise<void> {
    const plan = this.plans.find((p) => p.id === planId && p.userId === userId);
    this.deleteUpcoming(userId, planId, afterDay);
    for (const row of rows) {
      await this.transactions.create({
        userId,
        type: "expense",
        amount: row.amount,
        currency: plan?.currency ?? "TWD",
        categoryId: plan?.categoryId ?? "",
        date: row.day,
        note: plan?.note ?? null,
        planId,
        installmentNo: row.installmentNo,
      });
    }
  }

  async settle(userId: string, planId: string, afterDay: string, settlement: InstallmentSettlementRow): Promise<void> {
    this.deleteUpcoming(userId, planId, afterDay);
    await this.transactions.create({
      userId,
      type: "expense",
      amount: settlement.amount,
      currency: settlement.currency,
      categoryId: settlement.categoryId,
      date: settlement.day,
      note: settlement.note ?? null,
      planId,
      installmentNo: null,
    });
  }

  /** The fake's `DELETE WHERE user_id = ? AND plan_id = ? AND day > ?` — strict `>`, both scopes (D3b). */
  private deleteUpcoming(userId: string, planId: string, afterDay: string): void {
    this.transactions.transactions = this.transactions.transactions.filter(
      (t) => !(t.userId === userId && t.planId === planId && t.date > afterDay),
    );
  }
}
