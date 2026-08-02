import type { ExpenseGroup } from "../domain/expense-group";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";

/** Use case: the groups the caller is a member of. */
export async function listMyGroups(repository: ExpenseGroupRepository, userId: string): Promise<ExpenseGroup[]> {
  return repository.listForUser(userId.toLowerCase());
}
