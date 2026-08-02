import type { ExpenseGroup, GroupMember } from "../domain/expense-group";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";

export interface GroupWithMembers {
  group: ExpenseGroup;
  members: GroupMember[];
}

/**
 * Use case: the groups the caller is a member of, each with its members.
 *
 * Members come along because every screen that renders a grouped expense
 * needs a name for each participant, and a participant of a grouped expense
 * is always a member of that group. Returning them here means the listing is
 * one round trip plus one, rather than one per group.
 */
export async function listMyGroups(repository: ExpenseGroupRepository, userId: string): Promise<GroupWithMembers[]> {
  const groups = await repository.listForUser(userId.toLowerCase());
  if (groups.length === 0) return [];
  const members = await repository.listMembersForGroups(groups.map((group) => group.id));
  const byGroup = new Map<string, GroupMember[]>();
  for (const member of members) {
    const list = byGroup.get(member.groupId);
    if (list) list.push(member);
    else byGroup.set(member.groupId, [member]);
  }
  return groups.map((group) => ({ group, members: byGroup.get(group.id) ?? [] }));
}
