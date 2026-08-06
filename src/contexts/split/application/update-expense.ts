import { ExpenseNotFound, InvalidSplitInput } from "../domain/errors";
import type { SplitExpense } from "../domain/split-expense";
import type { CreateExpenseDeps } from "./create-expense";
import type { UpdateExpenseInput } from "./expense-input";
import { writeMirrorAftermath } from "./mirror-aftermath";
import { validateExpenseFields } from "./validate-expense-fields";

/**
 * Use case: edit an owned expense. Only `created_by_user_id` or
 * `payer_user_id` may edit — any other participant gets `ExpenseNotFound`.
 * Reruns every creation rule (`validateExpenseFields`) EXCEPT the
 * archived-group gate, which blocks only creation and adding members, never
 * correcting an existing expense (design.md). `group_id` and
 * `created_by_user_id` are immutable: the former is rejected if the caller
 * supplies a different value, the latter has no input field at all.
 */
export async function updateExpense(deps: CreateExpenseDeps, callerUserId: string, expenseId: string, input: UpdateExpenseInput, now: Date = new Date()): Promise<SplitExpense> {
  const caller = callerUserId.toLowerCase();

  const existing = await deps.expenses.findById(expenseId);
  if (!existing) throw new ExpenseNotFound();
  if (existing.createdByUserId !== caller && existing.payerUserId !== caller) throw new ExpenseNotFound();

  // Compared as lowercase canonical uuid, like every other id in this context:
  // `existing.groupId` comes back from a Postgres `uuid` column (always
  // lowercase) while the body accepts either case, so a client echoing the
  // same group id back in uppercase would otherwise be told it changed it.
  if (input.groupId !== undefined) {
    const requestedGroupId = input.groupId === null ? null : input.groupId.toLowerCase();
    if (requestedGroupId !== existing.groupId) throw new InvalidSplitInput("group_id cannot be changed");
  }

  const validated = await validateExpenseFields(
    { groups: deps.groups, friends: deps.friends },
    {
      callerUserId: caller,
      groupId: existing.groupId,
      payerUserId: input.payerUserId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      day: input.day,
      categoryName: input.categoryName,
      split: input.split,
      checkArchived: false,
    },
  );

  // Planned before the write, like `createExpense`: the mirrors travel in the
  // same batch as the expense, so they must exist before it is built.
  const mirrors = await deps.mirror.plan({
    splitExpenseId: expenseId,
    currency: validated.currency,
    day: validated.day,
    description: validated.description,
    categoryName: validated.categoryName,
    shares: validated.shares,
  });

  const written = await deps.expenses.update(expenseId, validated, mirrors, now, caller);
  if (!written) throw new ExpenseNotFound();

  // The stored rows, not the planned ones. An edit keeps the category of a
  // mirror its owner recategorised, so on this path the two routinely differ —
  // and checking the planned category would check a budget the row does not
  // count towards while never checking the one it does.
  await writeMirrorAftermath(deps.mirror, written.mirrors);
  return written.expense;
}
