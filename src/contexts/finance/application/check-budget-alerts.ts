import type { BudgetAlertMessage, BudgetAlertNotifier } from "../domain/budget-alert-notifier";
import type { FinanceBudget } from "../domain/finance-budget";
import type { FinanceBudgetRepository } from "../domain/finance-budget-repository";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { FinanceTransactionType } from "../domain/finance-transaction";
import { localParts } from "../../../shared/reminder-clock";

const THRESHOLDS = [80, 100] as const;

export interface CheckBudgetAlertsDeps {
  budgetRepository: FinanceBudgetRepository;
  categoryRepository: FinanceCategoryRepository;
  notifier: BudgetAlertNotifier;
  /**
   * add-installments (design.md D4b): alerts fire only for transaction months
   * ≤ the user's own today — a future-month write must not burn that month's
   * one (budget, month, threshold) alert row. Both are needed to know the
   * user's today; when absent the check behaves as before.
   */
  now?: () => Date;
  getUserTimezone?: (userId: string) => Promise<string>;
}

export interface CheckBudgetAlertsInput {
  userId: string;
  type: FinanceTransactionType;
  currency: string;
  /** The transaction's (current, post-write) category. */
  categoryId: string;
  /** On update, the category before the write, when it changed — both are checked. Omit/equal to `categoryId` when unchanged. */
  previousCategoryId?: string;
  /** The transaction's own date (`YYYY-MM-DD`) — its month is checked, not "today" (design.md: backdated writes check their own month). */
  date: string;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

async function buildMessage(categoryRepository: FinanceCategoryRepository, budget: FinanceBudget, month: string, threshold: 80 | 100): Promise<BudgetAlertMessage> {
  const monthNumber = Number(month.slice(5, 7));
  let scopeLabel = "";
  if (budget.categoryId !== null) {
    const category = await categoryRepository.findById(budget.categoryId);
    scopeLabel = category?.name ?? "";
  }

  if (threshold === 80) {
    return {
      title: "預算提醒",
      body: budget.categoryId === null ? `${monthNumber}月支出已達預算 8 成` : `${monthNumber}月${scopeLabel}支出已達預算 8 成`,
    };
  }
  return {
    title: "預算超支",
    body: budget.categoryId === null ? `${monthNumber}月支出已超過預算` : `${monthNumber}月${scopeLabel}支出已超過預算`,
  };
}

async function checkBudget(deps: CheckBudgetAlertsDeps, userId: string, categoryId: string | null, month: string): Promise<void> {
  const budget = await deps.budgetRepository.findByUserAndCategory(userId, categoryId);
  if (!budget) return;

  const spent = await deps.budgetRepository.getSpent(userId, categoryId, month);

  for (const threshold of THRESHOLDS) {
    // Integer arithmetic to avoid floating-point truncation (design.md): spent*100 >= amount*threshold.
    if (spent * 100 < budget.amount * threshold) continue;

    const recorded = await deps.budgetRepository.tryRecordAlert({ userId, budgetId: budget.id, month, threshold });
    if (!recorded) continue; // already alerted this (budget, month, threshold) — including under concurrent writes

    const message = await buildMessage(deps.categoryRepository, budget, month, threshold);
    try {
      await deps.notifier.notify(userId, message);
    } catch (err) {
      console.error("budget alert push failed", err);
    }
  }
}

/**
 * Use case: level-triggered, monthly-deduped budget threshold check, called
 * after a successful TWD expense transaction write (design.md). No-op for
 * non-TWD or income transactions. Checks the overall budget plus the
 * transaction's category budget; on an update where the category changed,
 * both the old and new category budgets are checked. Never throws — a
 * notifier failure is caught and logged, not propagated.
 */
export async function checkBudgetAlerts(deps: CheckBudgetAlertsDeps, input: CheckBudgetAlertsInput): Promise<void> {
  if (input.type !== "expense" || input.currency !== "TWD") return;

  const month = monthOf(input.date);

  // add-installments design.md D4b: a write dated in a month that has not
  // arrived yet must not raise (and so dedup-burn) that month's alert. Gated
  // on both `now`/`getUserTimezone` being supplied — when either is absent
  // this behaves exactly as before (every existing caller that doesn't pass
  // them keeps the old, ungated behavior). "≤ the user's today", not
  // "backdated/plan writes never alert": the latter would also silence an
  // early settlement's today-dated transaction, which is the largest single
  // expense this feature can produce.
  if (deps.now && deps.getUserTimezone) {
    const today = localParts(deps.now(), await deps.getUserTimezone(input.userId)).date;
    if (month > monthOf(today)) return;
  }
  const categoryIds = new Set<string | null>([null, input.categoryId]);
  if (input.previousCategoryId !== undefined && input.previousCategoryId !== input.categoryId) {
    categoryIds.add(input.previousCategoryId);
  }

  for (const categoryId of categoryIds) {
    await checkBudget(deps, input.userId, categoryId, month);
  }
}
