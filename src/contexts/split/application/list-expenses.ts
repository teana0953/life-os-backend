import { GroupNotFound, InvalidSplitInput } from "../domain/errors";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { SplitExpense } from "../domain/split-expense";
import type { ListExpensesFilter, SplitExpenseRepository } from "../domain/split-expense-repository";
import { participatesInExpense } from "./participation";

export interface ListExpensesDeps {
  expenses: SplitExpenseRepository;
  groups: ExpenseGroupRepository;
}

/**
 * Use case: list the caller's expenses. `groupId` and `withUserId` are
 * mutually exclusive (400 if both are given); neither given lists every
 * expense the caller participates in.
 *
 * The repository is expected to filter in SQL, but that SQL path has no test
 * coverage anywhere in this repo (design.md's accepted gap — every
 * `Drizzle*Repository` test uses a fake `Db` whose `where()` discards its
 * arguments). So this use case re-asserts participation on every returned
 * row and drops anything that fails — including counting group membership as
 * participation, so a legitimate group expense is never dropped — treating a
 * failure as a programming error rather than trusting the query alone.
 */
export async function listExpenses(deps: ListExpensesDeps, callerUserId: string, filter: ListExpensesFilter): Promise<SplitExpense[]> {
  const caller = callerUserId.toLowerCase();

  if (filter.groupId !== undefined && filter.withUserId !== undefined) {
    throw new InvalidSplitInput("group_id and with cannot both be given");
  }

  const callerGroupIds = new Set<string>();
  if (filter.groupId !== undefined) {
    const members = await deps.groups.membersAmong(filter.groupId, [caller]);
    if (!members.has(caller)) throw new GroupNotFound();
    callerGroupIds.add(filter.groupId.toLowerCase());
  }

  const rows = await deps.expenses.listForUser(caller, filter);

  // Resolve the caller's membership once per distinct group rather than once
  // per row: the membership branch is exactly the common case (a member
  // browsing a group's expenses), so the per-row form was N sequential
  // neon-http queries for an N-row listing.
  const unresolvedGroupIds = new Set<string>();
  for (const row of rows) {
    if (row.groupId === null) continue;
    const groupId = row.groupId.toLowerCase();
    if (callerGroupIds.has(groupId)) continue;
    // Rows the caller already participates in on their own need no lookup.
    if (participatesInExpense(row, caller, callerGroupIds)) continue;
    unresolvedGroupIds.add(groupId);
  }
  for (const groupId of unresolvedGroupIds) {
    const members = await deps.groups.membersAmong(groupId, [caller]);
    if (members.has(caller)) callerGroupIds.add(groupId);
  }

  const verified: SplitExpense[] = [];
  for (const row of rows) {
    if (participatesInExpense(row, caller, callerGroupIds)) {
      verified.push(row);
    } else {
      console.error("listExpenses: dropped a row the caller does not participate in", { expenseId: row.id, callerUserId: caller });
    }
  }
  return verified;
}
