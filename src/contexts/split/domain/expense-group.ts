export interface ExpenseGroup {
  id: string;
  name: string;
  createdByUserId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  /**
   * Resolved from `users`, so a member can be named on screen. Without it the
   * only endpoint carrying names is `balances`, which omits anyone netting to
   * zero — a settled member would render as a bare uuid.
   */
  displayName: string;
  joinedAt: Date;
}

export interface CreateExpenseGroupInput {
  name: string;
  createdByUserId: string;
}
