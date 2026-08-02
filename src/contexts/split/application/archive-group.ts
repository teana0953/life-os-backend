import { GroupNotFound } from "../domain/errors";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";

/** Use case: archive a group. Only its creator may — anyone else, including other members, gets `GroupNotFound`. */
export async function archiveGroup(repository: ExpenseGroupRepository, callerUserId: string, groupId: string, now: Date = new Date()): Promise<void> {
  const group = await repository.findById(groupId);
  if (!group) throw new GroupNotFound();
  if (group.createdByUserId !== callerUserId.toLowerCase()) throw new GroupNotFound();
  const archived = await repository.archive(groupId, now);
  if (!archived) throw new GroupNotFound();
}
