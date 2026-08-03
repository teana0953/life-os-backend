import { isValidCurrencyCode } from "../domain/currency-code";
import { isValidDay } from "../domain/day";
import { CannotSettleWithSelf, GroupArchived, GroupNotFound, InvalidSplitInput, NotAGroupMember, NotAParticipant, NotFriends } from "../domain/errors";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { FriendChecker } from "../domain/friend-checker";
import type { Settlement } from "../domain/settlement";
import type { SettlementRepository } from "../domain/settlement-repository";
import { MAX_MINOR_UNITS } from "./validate-expense-fields";
import type { CreateSettlementInput } from "./settlement-input";

export interface CreateSettlementDeps {
  settlements: SettlementRepository;
  groups: ExpenseGroupRepository;
  friends: FriendChecker;
}

/**
 * Use case: record a repayment. Same anti-fabrication posture as
 * `createExpense` — the caller must be one of the two named people, so
 * nobody can record a settlement between two other people (design.md).
 */
export async function createSettlement(deps: CreateSettlementDeps, input: CreateSettlementInput): Promise<Settlement> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new InvalidSplitInput(`amount must be a positive integer: ${input.amount}`);
  }
  // `split_settlement.amount` is a Postgres `integer` (4-byte), the same
  // column type `split_expense.amount` uses — reuse its bound rather than
  // hardcoding it again.
  if (input.amount > MAX_MINOR_UNITS) {
    throw new InvalidSplitInput(`amount must not exceed ${MAX_MINOR_UNITS}: ${input.amount}`);
  }
  if (!isValidCurrencyCode(input.currency)) {
    throw new InvalidSplitInput(`currency must be three uppercase letters: ${input.currency}`);
  }
  if (!isValidDay(input.day)) {
    throw new InvalidSplitInput(`day must be a valid date (YYYY-MM-DD): ${input.day}`);
  }

  const fromUserId = input.fromUserId.toLowerCase();
  const toUserId = input.toUserId.toLowerCase();
  const callerUserId = input.callerUserId.toLowerCase();

  if (fromUserId === toUserId) throw new CannotSettleWithSelf();
  if (callerUserId !== fromUserId && callerUserId !== toUserId) throw new NotAParticipant();

  if (input.groupId !== null) {
    const groupId = input.groupId;
    const group = await deps.groups.findById(groupId);
    if (!group) throw new GroupNotFound();
    const members = await deps.groups.membersAmong(groupId, [fromUserId, toUserId]);
    if (!members.has(callerUserId)) throw new GroupNotFound();
    if (group.archivedAt !== null) throw new GroupArchived();
    if (!members.has(fromUserId) || !members.has(toUserId)) throw new NotAGroupMember();
  } else {
    // A friend **or** someone a group is shared with. Deliberately looser
    // than `createExpense`'s groupless rule, which requires friendship: a
    // debt can arise purely through a shared group between two people who
    // never became friends, and refusing to settle it would leave them
    // holding a balance with no way to clear it — an action the UI would
    // have to hide, on a debt that is real. You still cannot *create* a
    // groupless expense with them; you can only settle one you already have.
    const other = callerUserId === fromUserId ? toUserId : fromUserId;
    const friends = await deps.friends.friendsAmong(callerUserId, [other]);
    if (!friends.has(other) && !(await deps.groups.shareAnyGroup(callerUserId, other))) {
      throw new NotFriends();
    }
  }

  return deps.settlements.create({
    id: crypto.randomUUID(),
    groupId: input.groupId,
    fromUserId,
    toUserId,
    amount: input.amount,
    currency: input.currency,
    day: input.day,
    note: input.note,
    createdByUserId: callerUserId,
  });
}
