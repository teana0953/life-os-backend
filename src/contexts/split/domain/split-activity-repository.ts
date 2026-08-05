import type { SplitActivity, SplitActivityCursor } from "./split-activity";

export interface ListActivityOptions {
  /** How many entries at most. The caller always sets it; there is no unbounded read of this table. */
  limit: number;
  /** Return only entries strictly older than this point. Absent = start at the newest. */
  before?: SplitActivityCursor;
}

/**
 * The read side of the timeline. The write side deliberately has no port of its
 * own: every activity row is written by the repository that performs the change
 * it records, in the same `db.batch`, because two repositories called from a use
 * case is exactly the non-atomic arrangement this feature must not have
 * (design.md D3).
 */
export interface SplitActivityRepository {
  /**
   * Entries `userId` may see, newest first. **The filtering is the security
   * boundary of this feature** — an entry carries another person's amounts and
   * descriptions, so a wrong predicate here leaks them. It is hybrid by
   * necessity: a grouped entry is matched against the group's *current*
   * members, a groupless one against the audience frozen into the row when it
   * was written (design.md D2/D4).
   */
  listForUser(userId: string, options: ListActivityOptions): Promise<SplitActivity[]>;
}
