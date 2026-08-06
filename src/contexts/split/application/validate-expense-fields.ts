import { isValidCurrencyCode } from "../domain/currency-code";
import { isValidDay } from "../domain/day";
import { DuplicateParticipant, GroupArchived, GroupNotFound, InvalidSplitInput, NotAGroupMember, NotAParticipant, NotFriends, SplitTooSmall } from "../domain/errors";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { FriendChecker } from "../domain/friend-checker";
import { equalSplit, validateExactSplit } from "../domain/split-calculator";
import type { SplitMode, SplitShareInput } from "../domain/split-expense";
import type { SplitInput } from "./expense-input";

export interface ValidateExpenseFieldsDeps {
  groups: ExpenseGroupRepository;
  friends: FriendChecker;
}

export interface ValidateExpenseFieldsInput {
  callerUserId: string;
  /** The expense's group — immutable on edit, so callers pass the existing value there. */
  groupId: string | null;
  payerUserId: string;
  amount: number;
  currency: string;
  description: string;
  day: string;
  /** Free-form and unchecked at this boundary: the rules are this function's (see `normalizeCategoryName`). */
  categoryName?: unknown;
  split: SplitInput;
  /** Whether an archived group blocks this call. `false` for edits: archiving blocks only creation and adding members, never correcting an existing expense (design.md). */
  checkArchived: boolean;
}

export interface ValidatedExpenseFields {
  payerUserId: string;
  amount: number;
  currency: string;
  description: string;
  day: string;
  splitMode: SplitMode;
  categoryName: string | null;
  shares: SplitShareInput[];
}

/**
 * The full rule set that both creating and editing an expense must pass —
 * shared so editing can never be a lighter path than creating
 * (design.md: "編輯要重跑建立時的全部驗證,包含那兩條授權規則").
 *
 * Order: field shape -> compute shares from the split input -> the
 * "caller must have a stake" rule (the anti-fabrication rule) -> payer
 * and every share holder must be a group member (grouped) or the caller/a
 * friend (groupless). All user ids are compared as lowercase canonical UUID
 * strings, the same normalization `friendship` and `split-calculator` use.
 */
/** Postgres `integer` upper bound — the column type both amount columns use. */
export const MAX_MINOR_UNITS = 2147483647;

/**
 * `split_expense.category_name` is unbounded `text`, so the cap is here or
 * nowhere. It exists because this name is resolved against every
 * participant's own categories, and an unbounded one would let a payer write
 * an arbitrarily large string into other people's lookups.
 */
const MAX_CATEGORY_NAME_LENGTH = 100;

/**
 * An empty name means "none" — one fewer shape for callers to distinguish,
 * and the finance side only ever asks "is there a name to match".
 *
 * **Deliberately not trimmed.** Finance category names are stored exactly as
 * the user typed them, so trimming here would make a split's name stop
 * matching a category whose name really does have a space in it, and it
 * contradicts the spec's "reading them back returns the name that was given".
 */
function normalizeCategoryName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidSplitInput("category_name must be a string or null");
  if (value === "") return null;
  if (value.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new InvalidSplitInput(`category_name must not exceed ${MAX_CATEGORY_NAME_LENGTH} characters`);
  }
  return value;
}

export async function validateExpenseFields(deps: ValidateExpenseFieldsDeps, input: ValidateExpenseFieldsInput): Promise<ValidatedExpenseFields> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new InvalidSplitInput(`amount must be a positive integer: ${input.amount}`);
  }
  // `split_expense.amount` and `split_share.amount` are Postgres `integer`
  // (4-byte). Without this the value sails through every application check
  // and Postgres rejects it as 22003, which surfaces as a 500 — a bad request
  // reported as a server fault.
  if (input.amount > MAX_MINOR_UNITS) {
    throw new InvalidSplitInput(`amount must not exceed ${MAX_MINOR_UNITS}: ${input.amount}`);
  }
  if (!isValidCurrencyCode(input.currency)) {
    throw new InvalidSplitInput(`currency must be three uppercase letters: ${input.currency}`);
  }
  if (typeof input.description !== "string" || input.description.trim() === "") {
    throw new InvalidSplitInput("description is required");
  }
  if (!isValidDay(input.day)) {
    throw new InvalidSplitInput(`day must be a valid date (YYYY-MM-DD): ${input.day}`);
  }
  const categoryName = normalizeCategoryName(input.categoryName);

  const shares = computeShares(input.amount, input.split).map((share) => ({ userId: share.userId.toLowerCase(), amount: share.amount }));
  const payerUserId = input.payerUserId.toLowerCase();
  const callerUserId = input.callerUserId.toLowerCase();

  const participants = new Set([payerUserId, ...shares.map((share) => share.userId)]);
  if (participants.size <= 1) throw new SplitTooSmall();

  // Rejected for everyone, not only when the caller happens to be the one who
  // got the 0: an equal split of an amount below the participant count gives
  // the tail of the canonical-uuid order nothing. Deciding this inside the
  // stake check made the same payload succeed or fail depending on who asked
  // and on how the uuids happened to sort.
  if (input.split.mode === "equal" && input.amount < shares.length) {
    throw new InvalidSplitInput(
      `amount ${input.amount} is too small to give each of the ${shares.length} participants a share`,
    );
  }

  // The anti-fabrication rule needs an *economic* stake, not just an
  // appearance in the shares: `payer=B, shares=[{A:0},{C:1000}]` names A but
  // leaves A owing and owed nothing, which is the "A fabricates a debt
  // between B and C" case this rule exists to prevent (design.md). So the
  // caller counts only as the payer or as the holder of a share > 0. A zero
  // share for *other* participants stays legal — someone genuinely owing
  // nothing on a shared bill is a real case, and it cannot fabricate
  // anything, since the caller still has to be in the expense for real.
  const callerHasStake = payerUserId === callerUserId || shares.some((share) => share.userId === callerUserId && share.amount > 0);
  if (!callerHasStake) throw new NotAParticipant();

  if (input.groupId !== null) {
    const groupId = input.groupId;
    const group = await deps.groups.findById(groupId);
    if (!group) throw new GroupNotFound();
    const members = await deps.groups.membersAmong(groupId, [...participants]);
    if (!members.has(callerUserId)) throw new GroupNotFound();
    if (input.checkArchived && group.archivedAt !== null) throw new GroupArchived();
    for (const userId of participants) {
      if (!members.has(userId)) throw new NotAGroupMember();
    }
  } else {
    const others = [...participants].filter((userId) => userId !== callerUserId);
    const friends = others.length > 0 ? await deps.friends.friendsAmong(callerUserId, others) : new Set<string>();
    for (const userId of others) {
      if (!friends.has(userId)) throw new NotFriends();
    }
  }

  return {
    payerUserId,
    amount: input.amount,
    currency: input.currency,
    description: input.description,
    day: input.day,
    splitMode: input.split.mode,
    categoryName,
    shares,
  };
}

function computeShares(amount: number, split: SplitInput): SplitShareInput[] {
  if (split.mode === "equal") {
    const userIds = split.participantUserIds;
    if (userIds.length === 0) throw new InvalidSplitInput("participantUserIds must not be empty");
    assertNoDuplicates(userIds);
    return equalSplit(amount, userIds);
  }
  if (split.shares.length === 0) throw new InvalidSplitInput("shares must not be empty");
  assertNoDuplicates(split.shares.map((share) => share.userId));
  validateExactSplit(amount, split.shares);
  return split.shares;
}

function assertNoDuplicates(userIds: string[]): void {
  const lowered = userIds.map((id) => id.toLowerCase());
  if (new Set(lowered).size !== lowered.length) throw new DuplicateParticipant();
}
