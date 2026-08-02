import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { SplitExpense } from "../domain/split-expense";

/**
 * Whether `userId` may see `expense`: its payer, a share holder, or — for a
 * grouped expense — a member of that group. Shared by `getExpense` and
 * `listExpenses`, the latter using it as a second, in-memory assertion on
 * top of the repository's own filtering (design.md's accepted gap: the SQL
 * path has no test coverage in this repo, so it must not be the only thing
 * standing between a mistake and another user's expenses leaking).
 */
export async function isParticipant(groups: ExpenseGroupRepository, expense: SplitExpense, userId: string): Promise<boolean> {
  const id = userId.toLowerCase();
  if (participatesInExpense(expense, id, EMPTY_GROUP_IDS)) return true;
  if (expense.groupId) {
    const members = await groups.membersAmong(expense.groupId, [id]);
    return members.has(id);
  }
  return false;
}

const EMPTY_GROUP_IDS: ReadonlySet<string> = new Set();

/**
 * The same rule with no I/O: `callerGroupIds` is the set of (lowercase) group
 * ids the caller is already known to be a member of. `listExpenses` resolves
 * that set once per distinct group instead of asking per row — the per-row
 * form was one `membersAmong` round trip per listed expense.
 */
export function participatesInExpense(expense: SplitExpense, userId: string, callerGroupIds: ReadonlySet<string>): boolean {
  const id = userId.toLowerCase();
  if (expense.payerUserId === id) return true;
  if (expense.shares.some((share) => share.userId === id)) return true;
  return expense.groupId !== null && callerGroupIds.has(expense.groupId.toLowerCase());
}
