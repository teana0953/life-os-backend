/** A group doesn't exist, or the caller is not one of its members (route maps this to 404, never leaking existence). */
export class GroupNotFound extends Error {}

/** An expense doesn't exist, or the caller does not participate in it (route maps this to 404). */
export class ExpenseNotFound extends Error {}

/** The caller would end up neither the payer nor a share holder of the expense they are creating or editing. */
export class NotAParticipant extends Error {}

/** A split's shares did not sum to the expense amount (route maps this to 400; the message states the discrepancy). */
export class SharesDoNotSumToAmount extends Error {
  constructor(
    readonly amount: number,
    readonly sharesSum: number,
  ) {
    super(`shares sum to ${sharesSum}, but the expense amount is ${amount} (difference ${amount - sharesSum})`);
  }
}

/** A named user is not the caller's friend (route maps this to 400 — the caller supplied the id, so no existence is disclosed). */
export class NotFriends extends Error {}

/** A named user is not a member of the expense's group (route maps this to 400). */
export class NotAGroupMember extends Error {}

/** The group is archived: it cannot take new expenses or new members (route maps this to 400). */
export class GroupArchived extends Error {}

/** An expense would name only the caller — that is personal bookkeeping, not a split (route maps this to 400). */
export class SplitTooSmall extends Error {}

/** The same user appears twice among an expense's shares (route maps this to 400). */
export class DuplicateParticipant extends Error {}

/** The user being added to a group is already one of its members (route maps this to 400, rather than letting the unique constraint 500). */
export class AlreadyAGroupMember extends Error {}

/** Generic input validation failure — amount, currency, day, description, split mode, or an attempt to change an immutable field (route maps this to 400). */
export class InvalidSplitInput extends Error {}
