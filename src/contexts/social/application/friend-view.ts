import type { Friend, FriendUserRecord } from "../domain/friend-user";

/**
 * The one place a repository record becomes something a caller may see.
 * A user with no display name is shown the local part of their email — the
 * address itself never leaves this function, and `Friend` has no field it
 * could leave through (add-friends/design.md "資訊揭露原則").
 */
export function toFriend(record: FriendUserRecord): Friend {
  const displayName = record.displayName?.trim();
  return { userId: record.userId, displayName: displayName ? displayName : emailLocalPart(record.email) };
}

function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}
