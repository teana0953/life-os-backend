/**
 * The two views of "another user" in this context, kept deliberately apart.
 *
 * `FriendUserRecord` is what a repository reads — the *minimum* columns needed
 * to derive a name, never a whole user row. `Friend` is what leaves the
 * application, and it has **no email field at all**, so returning an address
 * to a caller does not type-check (structural block, not a written rule —
 * add-friends/design.md "資訊揭露原則").
 */

/** Repository-facing record: only the columns a display name can be derived from. */
export interface FriendUserRecord {
  userId: string;
  displayName: string | null;
  email: string;
}

/** Outward-facing friend view: an id to act on, and a name. No email, ever. */
export interface Friend {
  userId: string;
  displayName: string;
}
