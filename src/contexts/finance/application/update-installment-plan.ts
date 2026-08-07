import { type CheckBudgetAlertsDeps, checkBudgetAlerts } from "./check-budget-alerts";
import type { InstallmentDeps } from "./create-installment-plan";
import { InstallmentPlanNotFound, InvalidFinanceInputError } from "../domain/errors";
import type { InstallmentRow } from "../domain/installment-plan";
import { addMonthsAnchored, assertValidPeriods, divideEvenly } from "./installment-support";
import { localParts } from "../../../shared/reminder-clock";

export interface UpdateInstallmentPlanInput {
  userId: string;
  planId: string;
  /**
   * Plan mode `total`: the NEW total — what is rewritten is
   * `amount − (sum of the EXISTING already-due instalment rows)` spread over
   * the remaining periods (D2b/D5). Plan mode `per_installment`: the new
   * per-instalment amount, used as given.
   */
  amount: number;
  /** The plan's new total number of periods. */
  periods: number;
}

/**
 * Use case: change a plan's remaining instalments. Instalments that have
 * already fallen due — judged against the USER's today, not UTC's (D5) — are
 * left exactly as they are; only the ones still to come are rewritten, dated
 * from the plan's original `startDay` (D3), never from "today" or from the
 * previous instalment. Every money computation reads the EXISTING instalment
 * rows, never the plan's stored total (D2b): a `total`-mode remaining amount
 * is the new total minus what the still-existing due rows actually sum to.
 *
 * Known limitation, not exercised by any test: the plan's own stored
 * `periods`/`amount` (its creation-time record) are not rewritten here, so a
 * read of the plan after an update still reports the values it was created
 * with, not the current ones.
 */
export async function updateInstallmentPlan(
  deps: InstallmentDeps,
  input: UpdateInstallmentPlanInput,
  budgetAlertDeps?: CheckBudgetAlertsDeps,
): Promise<void> {
  const plan = await deps.planRepository.findById(input.planId);
  if (!plan || plan.userId !== input.userId) throw new InstallmentPlanNotFound();

  const periods = assertValidPeriods(input.periods);
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new InvalidFinanceInputError(`amount must be a positive integer: ${input.amount}`);
  }

  const today = localParts(deps.now(), await deps.getUserTimezone(input.userId)).date;
  const existing = await deps.planRepository.listInstallments(input.userId, input.planId);
  // Today's own instalment counts as already fallen due (D5): it keeps its
  // amount/date exactly like every other due row, so the boundary is `<=`.
  const due = existing.filter((t) => t.date <= today);

  const remaining = periods - due.length;
  if (remaining <= 0) {
    throw new InvalidFinanceInputError("no periods remain to change — every instalment up to the new period count has already fallen due");
  }

  const dueSum = due.reduce((sum, t) => sum + t.amount, 0);
  const amounts = plan.mode === "total" ? divideEvenly(input.amount - dueSum, remaining) : Array.from({ length: remaining }, () => input.amount);

  const rows: InstallmentRow[] = amounts.map((amount, i) => ({
    installmentNo: due.length + i + 1,
    day: addMonthsAnchored(plan.startDay, due.length + i),
    amount,
  }));

  await deps.planRepository.rewriteUpcoming(input.userId, input.planId, today, rows);

  if (budgetAlertDeps) {
    for (const row of rows) {
      try {
        await checkBudgetAlerts(budgetAlertDeps, {
          userId: input.userId,
          type: "expense",
          currency: plan.currency,
          categoryId: plan.categoryId,
          date: row.day,
        });
      } catch (err) {
        console.error("budget alert check failed", err);
      }
    }
  }
}
