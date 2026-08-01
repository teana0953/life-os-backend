/**
 * How another user is seen in this context.
 *
 * There is exactly one shape, and it has **no email field at all**, so
 * returning an address to a caller does not type-check (structural block, not
 * a written rule — add-friends/design.md "資訊揭露原則"). An address is read
 * only inside a repository, and only to derive the fallback name below: it is
 * never carried across a port, so no layer above an adapter is ever holding
 * one it could leak.
 */

/** Outward-facing friend view: an id to act on, and a name. No email, ever. */
export interface Friend {
  userId: string;
  displayName: string;
}

/**
 * The name to show for a user row: their own display name, or the local part
 * of their email when they have none. Lives in the domain so every repository
 * (and its in-memory double) derives names identically — it is the single
 * place the address is touched.
 */
export function friendDisplayName(displayName: string | null, email: string): string {
  const trimmed = displayName?.trim();
  if (trimmed) return trimmed;
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}
