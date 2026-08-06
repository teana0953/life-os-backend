import { type CheckBudgetAlertsDeps, checkBudgetAlerts } from "./check-budget-alerts";
import { FinanceCategoryArchived, FinanceCategoryNotFound, FinanceCategoryTypeMismatch, FinanceTransactionNotFound, MirroredTransactionReadOnly } from "../domain/errors";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { FinanceTransaction, ReplaceFinanceTransactionInput } from "../domain/finance-transaction";
import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";
import { validateTransactionFields } from "./validate-transaction-fields";

/**
 * Which of a mirror's fields a full-replace update would actually rewrite.
 *
 * **The comparison is by value, not by presence.** `PUT` is a full replace,
 * so a client changing only the category *must* resend `amount`, `currency`
 * and `date`; refusing whatever was carried would make the one permitted edit
 * impossible (design.md D7). Both sides are already normalized by the time
 * this runs — `validateTransactionFields` uppercases the currency and
 * `requireDay` pins the date to `YYYY-MM-DD` — so a plain comparison is the
 * normalized one.
 *
 * **`type` belongs in this list as much as the amount does.** It is part of a
 * full replace, and flipping an expense to income takes the money out of every
 * budget's `spent` and out of the expense total while the split still says it
 * is owed: the very disagreement this feature exists to remove, reached
 * through an edit the API allows.
 */
function rewritesTheSplitsFacts(
  existing: FinanceTransaction,
  incoming: { type: FinanceTransaction["type"]; amount: number; currency: string; date: string },
): boolean {
  return (
    existing.type !== incoming.type ||
    existing.amount !== incoming.amount ||
    existing.currency !== incoming.currency ||
    existing.date !== incoming.date
  );
}

/**
 * Use case: full-replace update of an owned transaction. `category_id` must
 * exist, belong to the same user, and have a matching `type`. Archived is
 * blocked ONLY when the patch actually switches `category_id` — a
 * transaction already on an archived category stays editable (amount, date,
 * note) as long as its category is unchanged (design.md). When
 * `budgetAlertDeps` is provided, a successful TWD expense write additionally
 * triggers the budget-alert check for both the old and new category when the
 * category changed (add-finance-budgets design.md) — best-effort, never
 * changing this call's result.
 */
export async function updateTransaction(
  categoryRepository: FinanceCategoryRepository,
  transactionRepository: FinanceTransactionRepository,
  userId: string,
  id: string,
  input: ReplaceFinanceTransactionInput,
  budgetAlertDeps?: CheckBudgetAlertsDeps,
): Promise<FinanceTransaction> {
  const existing = await transactionRepository.findById(id);
  if (!existing || existing.userId !== userId) throw new FinanceTransactionNotFound();

  const { type, currency } = validateTransactionFields(input.type, input.amount, input.currency);

  const category = await categoryRepository.findById(input.categoryId);
  if (!category || category.userId !== userId) throw new FinanceCategoryNotFound();
  if (category.type !== type) throw new FinanceCategoryTypeMismatch();
  const categoryChanged = input.categoryId !== existing.categoryId;
  if (category.archived && categoryChanged) throw new FinanceCategoryArchived();

  if (existing.splitExpenseId !== null && rewritesTheSplitsFacts(existing, { type, amount: input.amount, currency, date: input.date })) {
    throw new MirroredTransactionReadOnly("a transaction mirrored from a split expense can only have its category and note changed here");
  }

  const updated = await transactionRepository.update(userId, id, {
    ...input,
    type,
    currency,
    // Picking the category by hand is what takes the row out of the split's
    // hands; from here on the payer's next edit moves the amount and leaves
    // the category alone (design.md D6). Set only on a mirror, and only when
    // the category really changed, so re-sending the same one is not an
    // implicit opt-out.
    ...(existing.splitExpenseId !== null && categoryChanged ? { categorySource: "manual" as const } : {}),
  });
  if (!updated) throw new FinanceTransactionNotFound();

  if (budgetAlertDeps) {
    try {
      await checkBudgetAlerts(budgetAlertDeps, {
        userId: updated.userId,
        type: updated.type,
        currency: updated.currency,
        categoryId: updated.categoryId,
        previousCategoryId: categoryChanged ? existing.categoryId : undefined,
        date: updated.date,
      });
    } catch (err) {
      console.error("budget alert check failed", err);
    }
  }

  return updated;
}
