import type { ExpenseGroup } from "../domain/expense-group";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";

/** Use case: create a group. The creator becomes its first member (design.md). */
export async function createGroup(repository: ExpenseGroupRepository, name: string, createdByUserId: string): Promise<ExpenseGroup> {
  return repository.create({ name, createdByUserId: createdByUserId.toLowerCase() });
}
