import { GroupNotFound } from "../domain/errors";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";

/** Use case: archive a group. Only its creator may — anyone else, including other members, gets `GroupNotFound`. */
export async function archiveGroup(repository: ExpenseGroupRepository, callerUserId: string, groupId: string, now: Date = new Date()): Promise<void> {
  const group = await repository.findById(groupId);
  if (!group) throw new GroupNotFound();
  if (group.createdByUserId !== callerUserId.toLowerCase()) throw new GroupNotFound();
  // The result is deliberately ignored: `archive` returns false when the group
  // was already archived, and the group *does* exist (checked above) and *is*
  // archived when this returns, so the caller got what they asked for. A 404
  // here would be a second untruth on top of the duplicate entry. What the
  // false buys is in the repository: nothing is written the second time.
  await repository.archive(groupId, now, callerUserId.toLowerCase());
}
