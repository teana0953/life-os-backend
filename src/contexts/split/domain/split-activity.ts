/**
 * What happened. One value per write use case in this context — eight of them,
 * because a timeline that records only some changes is worse than none: the
 * reader believes they saw everything.
 */
export type SplitActivityType =
  | "expense_created"
  | "expense_updated"
  | "expense_deleted"
  | "settlement_created"
  | "settlement_deleted"
  | "group_created"
  | "group_member_added"
  | "group_archived";

/**
 * One entry in the split-bills timeline.
 *
 * It carries its own copy of what it takes to render it, because the record it
 * describes may be gone (design.md D2). That means an entry can disagree with
 * the present — an expense renamed after the fact still shows its old
 * description here. That is the point: an entry says what happened at the time,
 * not what is true now.
 *
 * It stores `actorUserId`, never "you" (D5). "You added an expense" and "Ann
 * added an expense" are the same row read by two people; deciding that here
 * would mean one row per reader.
 */
export interface SplitActivity {
  id: string;
  type: SplitActivityType;
  actorUserId: string;
  actorDisplayName: string;
  /** `null` for a groupless expense/settlement. */
  groupId: string | null;
  /**
   * Joined from `expense_group`, not frozen: groups are never deleted, so the
   * name can always be resolved and the timeline never shows a stale one.
   */
  groupName: string | null;
  /** The expense/settlement/group this is about. May name a row that no longer exists. */
  subjectId: string | null;
  /** A settlement's other party, or the member who was added. */
  counterpartUserId: string | null;
  counterpartDisplayName: string | null;
  amount: number | null;
  /**
   * The amount before the edit. Set by every `expense_updated` entry, whether
   * or not the amount moved — "modified" with no numbers says nothing (D6),
   * so a reader is always handed both and compares them.
   *
   * It is **not** a "the amount changed" flag: a row with
   * `previousAmount === amount` is an ordinary edit that touched something
   * else, not an anomaly.
   */
  previousAmount: number | null;
  /**
   * What an `expense_updated` edit touched: any of `amount`, `currency`,
   * `description`, `day`, `payer`, `shares`. `null` on every other type.
   *
   * An **empty** list means an edit that changed nothing — an ordinary event,
   * since the update endpoint is a whole replace — and is deliberately
   * distinguishable from `null`. Without this field an edit that moved only
   * the split rendered as "someone modified this" with the amount identical
   * on both sides, which reads as nothing having happened while somebody's
   * balance quietly moved (issue #74).
   */
  changedFields: string[] | null;
  /**
   * Who joined and who left the split, as the names they had at the time.
   * Names rather than ids for the same reason the rest of the entry is a
   * snapshot: it has to render after the expense is gone.
   */
  addedDisplayNames: string[] | null;
  removedDisplayNames: string[] | null;
  /**
   * A repayment's direction, and `null` for everything that is not one:
   * `true` = the actor paid the counterpart, `false` = the counterpart paid
   * the actor.
   *
   * Without it a settlement entry is unreadable — actor, counterpart and
   * amount are identical whichever way the money went — and for a
   * `settlement_deleted` entry the settlement itself is gone, so no second
   * request can recover it. Stored relative to the actor rather than as two
   * event types so that one row serves both parties (D5): the actor renders
   * it as written, the counterpart renders it inverted.
   */
  actorIsPayer: boolean | null;
  currency: string | null;
  description: string | null;
  createdAt: Date;
}

/**
 * A keyset cursor: the `createdAt`/`id` of the last entry already returned.
 * `id` breaks ties, since two entries written in the same batch share a
 * timestamp and offset-based paging on an append-heavy timeline would show or
 * skip rows as new activity arrives underneath the reader.
 */
export interface SplitActivityCursor {
  createdAt: Date;
  id: string;
}
