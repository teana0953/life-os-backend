/**
 * The name to show for a user row: their own display name, or the local part
 * of their email when they have none. Mirrors
 * `social/domain/friend-user.ts`'s `friendDisplayName` — duplicated rather
 * than imported so split's domain has no cross-context import (CLAUDE.md
 * dependency rule: contexts are independent units).
 */
export function splitDisplayName(displayName: string | null, email: string): string {
  const trimmed = displayName?.trim();
  if (trimmed) return trimmed;
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}
