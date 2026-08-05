import type { BalanceRepository } from "../../../src/contexts/split/domain/balance-repository";
import type { ExpenseGroupRepository } from "../../../src/contexts/split/domain/expense-group-repository";
import type { FriendChecker } from "../../../src/contexts/split/domain/friend-checker";
import type { SettlementRepository } from "../../../src/contexts/split/domain/settlement-repository";
import type { SplitActivityRepository } from "../../../src/contexts/split/domain/split-activity-repository";
import type { SplitExpenseRepository } from "../../../src/contexts/split/domain/split-expense-repository";
import type { SplitSpendingRepository } from "../../../src/contexts/split/domain/split-spending-repository";

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}

/** Stubs for route tests that never touch the split-bills endpoints (see split.test.ts for the real fakes). */
export const stubExpenseGroupRepository: ExpenseGroupRepository = {
  create: notImplemented,
  findById: notImplemented,
  listForUser: notImplemented,
  archive: notImplemented,
  addMember: notImplemented,
  listMembers: notImplemented,
  listMembersForGroups: notImplemented,
  membersAmong: notImplemented,
  shareAnyGroup: notImplemented,
};

export const stubSplitExpenseRepository: SplitExpenseRepository = {
  create: notImplemented,
  findById: notImplemented,
  update: notImplemented,
  delete: notImplemented,
  listForUser: notImplemented,
};

export const stubSplitBalanceRepository: BalanceRepository = {
  balancesForUser: notImplemented,
  balancesForGroup: notImplemented,
};

export const stubSplitFriendChecker: FriendChecker = {
  friendsAmong: notImplemented,
};

export const stubSettlementRepository: SettlementRepository = {
  create: notImplemented,
  findById: notImplemented,
  delete: notImplemented,
  listForUser: notImplemented,
};

export const stubSplitSpendingRepository: SplitSpendingRepository = {
  splitSpendingForUser: notImplemented,
};

export const stubSplitActivityRepository: SplitActivityRepository = {
  listForUser: notImplemented,
};
