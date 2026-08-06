import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { FriendChecker } from "../domain/friend-checker";
import type { SharesMirror } from "../domain/shares-mirror";
import type { SplitExpense } from "../domain/split-expense";
import type { SplitExpenseRepository } from "../domain/split-expense-repository";
import { writeMirrorAftermath } from "./mirror-aftermath";
import type { CreateExpenseInput } from "./expense-input";
import { validateExpenseFields } from "./validate-expense-fields";

export interface CreateExpenseDeps {
  expenses: SplitExpenseRepository;
  groups: ExpenseGroupRepository;
  friends: FriendChecker;
  mirror: SharesMirror;
}

/**
 * Use case: record a new split expense. All authorization and validation
 * rules live in `validateExpenseFields`, shared with `updateExpense` so
 * editing can never be a lighter path than creating.
 *
 * The mirrored transactions are planned **here**, not in the repository: the
 * budget-alert check that follows them lives in this layer, and a plan built
 * inside the Drizzle adapter would be invisible to every test that runs on
 * the in-memory one (design.md D2).
 */
export async function createExpense(deps: CreateExpenseDeps, input: CreateExpenseInput): Promise<SplitExpense> {
  const validated = await validateExpenseFields(
    { groups: deps.groups, friends: deps.friends },
    {
      callerUserId: input.callerUserId,
      groupId: input.groupId,
      payerUserId: input.payerUserId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      day: input.day,
      categoryName: input.categoryName,
      split: input.split,
      checkArchived: true,
    },
  );

  // Generated here rather than by the repository because the mirrors have to
  // reference it before anything is written (design.md D2).
  const id = crypto.randomUUID();
  const mirrors = await deps.mirror.plan({
    splitExpenseId: id,
    currency: validated.currency,
    day: validated.day,
    description: validated.description,
    categoryName: validated.categoryName,
    shares: validated.shares,
  });

  const expense = await deps.expenses.create({ id, groupId: input.groupId, createdByUserId: input.callerUserId.toLowerCase(), ...validated }, mirrors);

  await writeMirrorAftermath(deps.mirror, mirrors);
  return expense;
}
