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
  joinedAt: Date;
}

export interface CreateExpenseGroupInput {
  name: string;
  createdByUserId: string;
}
