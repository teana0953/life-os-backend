import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { FriendChecker } from "../domain/friend-checker";
import type { SplitExpense } from "../domain/split-expense";
import type { SplitExpenseRepository } from "../domain/split-expense-repository";
import type { CreateExpenseInput } from "./expense-input";
import { validateExpenseFields } from "./validate-expense-fields";

export interface CreateExpenseDeps {
  expenses: SplitExpenseRepository;
  groups: ExpenseGroupRepository;
  friends: FriendChecker;
}

/**
 * Use case: record a new split expense. All authorization and validation
 * rules live in `validateExpenseFields`, shared with `updateExpense` so
 * editing can never be a lighter path than creating.
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
      split: input.split,
      checkArchived: true,
    },
  );

  return deps.expenses.create({
    id: crypto.randomUUID(),
    groupId: input.groupId,
    createdByUserId: input.callerUserId.toLowerCase(),
    ...validated,
  });
}
