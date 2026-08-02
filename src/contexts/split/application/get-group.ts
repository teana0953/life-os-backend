import { GroupNotFound } from "../domain/errors";
import type { ExpenseGroup, GroupMember } from "../domain/expense-group";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";

export interface GroupDetails {
  group: ExpenseGroup;
  members: GroupMember[];
}

/** Use case: a group's details and membership. Not a member -> `GroupNotFound` (visibility, not existence). */
export async function getGroup(repository: ExpenseGroupRepository, userId: string, groupId: string): Promise<GroupDetails> {
  const group = await repository.findById(groupId);
  if (!group) throw new GroupNotFound();
  const members = await repository.listMembers(groupId);
  if (!members.some((member) => member.userId === userId.toLowerCase())) throw new GroupNotFound();
  return { group, members };
}
