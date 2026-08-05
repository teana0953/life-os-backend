import { AlreadyAGroupMember, GroupArchived, GroupNotFound, NotFriends } from "../domain/errors";
import type { GroupMember } from "../domain/expense-group";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { FriendChecker } from "../domain/friend-checker";

export interface AddGroupMemberDeps {
  groups: ExpenseGroupRepository;
  friends: FriendChecker;
}

/**
 * Use case: a member adds another user to the group. The caller must already
 * be a member (else `GroupNotFound`, visibility); the group must not be
 * archived; and the added user must be the caller's friend — "not a friend"
 * is a 400, since the caller supplied that id (design.md). Re-adding someone
 * who is already a member is a 400 too: without this check the insert hits
 * `expense_group_member_group_id_user_id_unique` and a double-tapped "add
 * member" answers 500 instead of a readable error.
 */
export async function addGroupMember(deps: AddGroupMemberDeps, callerUserId: string, groupId: string, newUserId: string, now: Date = new Date()): Promise<GroupMember> {
  const caller = callerUserId.toLowerCase();
  const addedUserId = newUserId.toLowerCase();

  const group = await deps.groups.findById(groupId);
  if (!group) throw new GroupNotFound();
  const members = await deps.groups.membersAmong(groupId, [caller, addedUserId]);
  if (!members.has(caller)) throw new GroupNotFound();
  if (group.archivedAt !== null) throw new GroupArchived();
  if (members.has(addedUserId)) throw new AlreadyAGroupMember();

  const friends = await deps.friends.friendsAmong(caller, [addedUserId]);
  if (!friends.has(addedUserId)) throw new NotFriends();

  return deps.groups.addMember(groupId, addedUserId, now, caller);
}
