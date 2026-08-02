import type { CreateExpenseGroupInput, ExpenseGroup, GroupMember } from "./expense-group";

export interface ExpenseGroupRepository {
  /** Creates the group. The creator becomes its first member as part of the same write (design.md: "建立者自動入組"). */
  create(input: CreateExpenseGroupInput): Promise<ExpenseGroup>;
  findById(id: string): Promise<ExpenseGroup | null>;
  /** The groups `userId` is a member of. */
  listForUser(userId: string): Promise<ExpenseGroup[]>;
  /** Sets `archived_at`. Returns whether a row was archived (false if the group does not exist). */
  archive(id: string, now: Date): Promise<boolean>;
  addMember(groupId: string, userId: string, now: Date): Promise<GroupMember>;
  listMembers(groupId: string): Promise<GroupMember[]>;
  /** Of `userIds`, the subset that are members of `groupId` — one query for a whole batch, not one per user. */
  membersAmong(groupId: string, userIds: string[]): Promise<Set<string>>;
}
