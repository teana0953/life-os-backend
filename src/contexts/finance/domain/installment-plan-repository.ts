import type { FinanceTransaction } from "./finance-transaction";
import type { CreateInstallmentPlanRecord, InstallmentPlan, InstallmentRow, InstallmentSettlementRow } from "./installment-plan";

/**
 * Port for instalment plans (add-installments design.md D2/D3b/D6).
 *
 * The statement-count contract is part of this port, not an implementation
 * detail: neon-http's `db.batch` statement limit is unknowable (D3b), so every
 * write here MUST use a number of statements that does not grow with the
 * number of instalments — one multi-row `INSERT` to create, one
 * `DELETE ... WHERE user_id = ? AND plan_id = ? AND day > ?` to clear.
 * `user_id` in the delete predicate is not optional: without it, "plan ids
 * are unguessable" is doing duty as authorization while deleting someone
 * else's transactions.
 */
export interface InstallmentPlanRepository {
  /** Insert the plan and ALL its instalment transactions — the transactions in ONE multi-row INSERT, all in one batch. */
  createWithInstallments(plan: CreateInstallmentPlanRecord, rows: InstallmentRow[]): Promise<InstallmentPlan>;

  findById(id: string): Promise<InstallmentPlan | null>;

  /** The plan's EXISTING instalment transactions — the only source of truth for any money computation (D2b). */
  listInstallments(userId: string, planId: string): Promise<FinanceTransaction[]>;

  /**
   * Replace the instalments strictly after `afterDay` (the user's today —
   * today's instalment counts as already fallen due, D5) with `rows`:
   * one DELETE + one multi-row INSERT, in one batch.
   */
  rewriteUpcoming(userId: string, planId: string, afterDay: string, rows: InstallmentRow[]): Promise<void>;

  /**
   * Early settlement: delete the instalments strictly after `afterDay` (one
   * DELETE) and insert the single settlement transaction, in one batch —
   * both land or neither does (D6).
   */
  settle(userId: string, planId: string, afterDay: string, settlement: InstallmentSettlementRow): Promise<void>;
}
