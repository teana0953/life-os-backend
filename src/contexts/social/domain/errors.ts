/**
 * The invite token matched nothing (route maps this to 404, so a token that
 * never existed is indistinguishable from someone else's).
 */
export class InviteNotFound extends Error {}

/** The invite is past its 7-day expiry (route maps this to a distinct 400 so the user can be told why). */
export class InviteExpired extends Error {}

/** The invite was already accepted — including losing the race to a concurrent accept (distinct 400). */
export class InviteAlreadyUsed extends Error {}

/** The inviter revoked the invite (distinct 400). */
export class InviteRevoked extends Error {}

/** The accepting user is the inviter — you cannot befriend yourself (400). */
export class CannotFriendSelf extends Error {}
