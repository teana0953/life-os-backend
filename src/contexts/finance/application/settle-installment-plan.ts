import { type CheckBudgetAlertsDeps, checkBudgetAlerts } from "./check-budget-alerts";
import type { InstallmentDeps } from "./create-installment-plan";
import { InstallmentPlanNotFound, InvalidFinanceInputError } from "../domain/errors";
import { localParts } from "../../../shared-kernel/reminder-clock";

export interface SettleInstallmentPlanInput {
  userId: string;
  planId: string;
  /**
   * Plan mode `per_installment` (subscription/loan): REQUIRED — the payoff
   * figure copied from the bank. The sum of the remaining instalments contains
   * future interest the settlement avoids, so the system must never compute
   * this itself (D0/D6). Plan mode `total` (credit card): omitted — the amount
   * is the sum of the EXISTING not-yet-due instalment rows (D2b).
   */
  amount?: number;
}

/**
 * Use case: settle a plan early — delete every instalment still to come and
 * replace them with a single transaction dated the USER's today (D6). Today's
 * own instalment (if any) is NOT "still to come" (D5) and is left alone,
 * which is also why the settlement lands the same day without colliding with
 * it. The settlement amount is computed from the EXISTING rows, never the
 * plan's stored total (D2b), so a deleted instalment is not settled for.
 */
export async function settleInstallmentPlan(
  deps: InstallmentDeps,
  input: SettleInstallmentPlanInput,
  budgetAlertDeps?: CheckBudgetAlertsDeps,
): Promise<void> {
  const plan = await deps.planRepository.findById(input.planId);
  if (!plan || plan.userId !== input.userId) throw new InstallmentPlanNotFound();

  const today = localParts(deps.now(), await deps.getUserTimezone(input.userId)).date;
  const existing = await deps.planRepository.listInstallments(input.userId, input.planId);
  const upcoming = existing.filter((t) => t.date > today);
  if (upcoming.length === 0) {
    throw new InvalidFinanceInputError("nothing left to settle — every instalment has already fallen due or been removed");
  }

  let amount: number;
  if (plan.mode === "per_installment") {
    // Never derived (D0/D6): the remaining instalments' sum includes future
    // interest the settlement avoids, so it is not the payoff figure.
    if (input.amount === undefined || !Number.isInteger(input.amount) || input.amount <= 0) {
      throw new InvalidFinanceInputError("amount is required to settle a per-instalment plan — copy the payoff figure from the bank, it cannot be derived");
    }
    amount = input.amount;
  } else {
    amount = upcoming.reduce((sum, t) => sum + t.amount, 0);
  }

  await deps.planRepository.settle(input.userId, input.planId, today, {
    day: today,
    amount,
    currency: plan.currency,
    categoryId: plan.categoryId,
    note: plan.note,
  });

  if (budgetAlertDeps) {
    try {
      await checkBudgetAlerts(budgetAlertDeps, {
        userId: input.userId,
        type: "expense",
        currency: plan.currency,
        categoryId: plan.categoryId,
        date: today,
      });
    } catch (err) {
      console.error("budget alert check failed", err);
    }
  }
}
