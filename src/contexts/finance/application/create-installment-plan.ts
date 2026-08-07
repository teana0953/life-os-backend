import type { CheckBudgetAlertsDeps } from "./check-budget-alerts";
import { FinanceCategoryArchived, FinanceCategoryNotFound, FinanceCategoryTypeMismatch } from "../domain/errors";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { InstallmentPlan, InstallmentPlanMode, InstallmentRow } from "../domain/installment-plan";
import type { InstallmentPlanRepository } from "../domain/installment-plan-repository";
import { validateTransactionFields } from "./validate-transaction-fields";
import { addMonthsAnchored, assertValidPeriods, divideEvenly } from "./installment-support";

/**
 * Shared deps for the instalment use cases. `now` + `getUserTimezone` exist
 * because "today" — the boundary between instalments that have fallen due and
 * those still to come — is the USER's today (`users.timezone`, default
 * Asia/Taipei), not UTC's (design.md D5). The clock is injectable or the
 * cross-midnight boundary cannot be tested at all.
 */
export interface InstallmentDeps {
  planRepository: InstallmentPlanRepository;
  categoryRepository: FinanceCategoryRepository;
  now: () => Date;
  getUserTimezone: (userId: string) => Promise<string>;
}

export interface CreateInstallmentPlanInput {
  userId: string;
  /** `total`: amount is the total, divided evenly (remainder +1 on the earliest instalments, D4). `per_installment`: amount is copied to every instalment, never divided (D0). */
  mode: InstallmentPlanMode;
  amount: number;
  periods: number;
  currency: string;
  /** Must be an expense category — instalments are expense-only (D7). */
  categoryId: string;
  /** First instalment's date; anchor for every later month (D3). */
  startDay: string;
  note?: string | null;
}

/**
 * Use case: record a purchase as an instalment plan and write every one of
 * its instalments as an ordinary `finance_transaction` row up front
 * (design.md D1). Dates are anchored on `startDay` (D3); a `total` amount is
 * divided with the remainder on the earliest instalments (D4); a
 * `per_installment` amount is copied to every row unchanged — never divided
 * (D0). Creating a plan never raises a budget alert, for any period — see the
 * note at the end of the body for why the D4b gate alone is not enough.
 */
export async function createInstallmentPlan(
  deps: InstallmentDeps,
  input: CreateInstallmentPlanInput,
  budgetAlertDeps?: CheckBudgetAlertsDeps,
): Promise<InstallmentPlan> {
  const periods = assertValidPeriods(input.periods);
  // Instalments are expense-only (D7); `type` is fixed, not part of the input.
  const { currency } = validateTransactionFields("expense", input.amount, input.currency);

  const category = await deps.categoryRepository.findById(input.categoryId);
  if (!category || category.userId !== input.userId) throw new FinanceCategoryNotFound();
  if (category.type !== "expense") throw new FinanceCategoryTypeMismatch();
  if (category.archived) throw new FinanceCategoryArchived();

  const amounts = input.mode === "total" ? divideEvenly(input.amount, periods) : Array.from({ length: periods }, () => input.amount);

  const rows: InstallmentRow[] = amounts.map((amount, i) => ({
    installmentNo: i + 1,
    day: addMonthsAnchored(input.startDay, i),
    amount,
  }));

  const plan = await deps.planRepository.createWithInstallments(
    {
      userId: input.userId,
      mode: input.mode,
      periods,
      startDay: input.startDay,
      amount: input.amount,
      currency,
      categoryId: input.categoryId,
      note: input.note ?? null,
    },
    rows,
  );

  // Creating a plan raises **no** alert, for any period, past or future
  // (tasks 6b.2). `checkBudgetAlerts`'s own "month ≤ today" gate (D4b) is not
  // enough here and the two rules read as contradicting each other: a plan
  // entered part-way through — a mortgage already paid for eight months — has
  // every past period at a month ≤ today, so the gate lets them all through.
  // That would push "you overspent in March" eight times at once *and* consume
  // each of those months' (budget, month, threshold) dedup rows, so a real
  // overspend in any of them could never be reported again.
  //
  // The user is recording a fact about money already spent, not spending it
  // now. Editing a single instalment afterwards still alerts normally (that is
  // a real decision about a real month), and so does settling, which inserts a
  // genuinely new charge dated today.
  void budgetAlertDeps;

  return plan;
}
