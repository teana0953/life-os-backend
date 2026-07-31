/** A net-worth account doesn't exist, or belongs to another user (route maps this to 404, never leaking existence). */
export class NetWorthAccountNotFound extends Error {}

/** A snapshot write targeted an archived account (archived accounts reject new snapshots; existing ones stay readable) (route maps this to 400). */
export class NetWorthAccountArchived extends Error {}

/** A create/rename collided with another of the user's accounts of the same kind (route maps this to 400). */
export class NetWorthAccountNameConflict extends Error {}

/** An account create supplied a `kind` outside the fixed `"asset" | "liability"` set (route maps this to 400). */
export class NetWorthInvalidKind extends Error {}
