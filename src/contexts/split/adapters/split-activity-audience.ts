/**
 * The people a **groupless** activity entry is written for, deduplicated.
 *
 * Two rules are baked in here rather than repeated at every call site:
 *
 * - **The actor is always included.** Nothing in the visibility rules mentions
 *   who performed the change, so leaving them out means the person who deleted
 *   an expense cannot see that they deleted it (tasks 1b.2). Every caller
 *   passes the actor first.
 * - **Duplicates are removed.** The actor is usually also a participant, and
 *   `= ANY(...)` would not care, but a stored array with the same id twice is
 *   noise in every assertion and every debug session.
 *
 * A **grouped** entry must not use this: it stores NULL and is matched against
 * the group's current members at read time (design.md D2).
 */
export function grouplessAudience(userIds: string[]): string[] {
  return [...new Set(userIds)];
}
