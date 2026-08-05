import type { CreateExpenseGroupInput, ExpenseGroup, GroupMember } from "./expense-group";

export interface ExpenseGroupRepository {
  /** Creates the group, its first membership row (the creator) and its activity entry in one batch (design.md: "建立者自動入組"). */
  create(input: CreateExpenseGroupInput): Promise<ExpenseGroup>;
  findById(id: string): Promise<ExpenseGroup | null>;
  /** The groups `userId` is a member of. */
  listForUser(userId: string): Promise<ExpenseGroup[]>;
  /**
   * Sets `archived_at`, writing the activity entry in the same batch — hence
   * `actorUserId`. Returns whether this call is what archived the group:
   * `false` if it does not exist, and `false` if it was **already archived**,
   * in which case nothing is written at all — archiving is one-way, and a
   * second call must not add a second "archived" entry to the timeline.
   */
  archive(id: string, now: Date, actorUserId: string): Promise<boolean>;
  /** Adds `userId`, writing the activity entry in the same batch. `actorUserId` is the member doing the adding, not the one added. */
  addMember(groupId: string, userId: string, now: Date, actorUserId: string): Promise<GroupMember>;
  listMembers(groupId: string): Promise<GroupMember[]>;

  /**
   * Members of several groups in one round trip. The listing screen needs a
   * name for every participant it renders, and a participant of a group
   * expense is always a member of that group — so one call here covers every
   * grouped expense the caller can see, instead of one `listMembers` per
   * group.
   */
  listMembersForGroups(groupIds: string[]): Promise<GroupMember[]>;
  /** Of `userIds`, the subset that are members of `groupId` — one query for a whole batch, not one per user. */
  membersAmong(groupId: string, userIds: string[]): Promise<Set<string>>;

  /**
   * Whether the two users belong to at least one group together.
   *
   * Settling a person-to-person debt needs this: a debt can arise purely
   * through a shared group, and the two people need never have become
   * friends — so requiring friendship to settle it would leave them holding
   * a balance with no way to clear it.
   */
  shareAnyGroup(userId: string, otherUserId: string): Promise<boolean>;
}
