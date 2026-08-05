import { InvalidSplitInput } from "../domain/errors";
import type { SplitActivity, SplitActivityCursor } from "../domain/split-activity";
import type { SplitActivityRepository } from "../domain/split-activity-repository";

export const DEFAULT_ACTIVITY_LIMIT = 50;
export const MAX_ACTIVITY_LIMIT = 100;

export interface ListActivityInput {
  limit?: number;
  /** The opaque `next_cursor` from a previous page. */
  cursor?: string;
}

export interface ActivityPage {
  entries: SplitActivity[];
  /** Pass back as `cursor` for the next page. `null` = this was the last one. */
  nextCursor: string | null;
}

/**
 * Cursors are `<iso timestamp>|<uuid>` rather than an offset. This timeline
 * only ever grows at the head, and with an offset every new entry written while
 * a reader is paging shifts everything down one — they see an entry twice and
 * miss another. The id is in the cursor because entries written in the same
 * batch share their timestamp exactly — every write path takes it from one JS
 * `Date`, so the timestamp alone cannot order them.
 */
function encodeCursor(entry: SplitActivity): string {
  return `${entry.createdAt.toISOString()}|${entry.id}`;
}

const CURSOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): SplitActivityCursor {
  const separator = cursor.indexOf("|");
  if (separator === -1) throw new InvalidSplitInput("cursor is malformed");
  const createdAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  // The id half must be a uuid *here*, not further down: the repository casts
  // it (`::uuid`) inside the keyset comparison, so anything else reaches
  // Postgres and raises — a caller's malformed cursor served back as a 500,
  // when it is a 400 like every other bad filtering input.
  if (Number.isNaN(createdAt.getTime()) || !CURSOR_ID_RE.test(id)) throw new InvalidSplitInput("cursor is malformed");
  return { createdAt, id };
}

/**
 * Use case: the caller's activity timeline, newest first.
 *
 * There is no participation re-check on top of the repository here, unlike
 * `listExpenses`: an activity entry has no live record to re-derive an audience
 * from — for a deleted groupless expense the frozen audience *is* the only
 * answer that exists. The repository's predicate is therefore the only gate,
 * which is why it is tested directly against a real Postgres.
 */
export async function listActivity(repository: SplitActivityRepository, callerUserId: string, input: ListActivityInput = {}): Promise<ActivityPage> {
  const requested = input.limit ?? DEFAULT_ACTIVITY_LIMIT;
  if (!Number.isInteger(requested) || requested <= 0) throw new InvalidSplitInput(`limit must be a positive integer: ${requested}`);
  const limit = Math.min(requested, MAX_ACTIVITY_LIMIT);

  const options = input.cursor === undefined ? { limit } : { limit, before: decodeCursor(input.cursor) };
  const entries = await repository.listForUser(callerUserId.toLowerCase(), options);

  // A short page means the end. A full one may or may not be, and asking for
  // one extra row to find out is not worth a second shape of response — the
  // next request simply comes back empty.
  const last = entries[entries.length - 1];
  return { entries, nextCursor: entries.length === limit && last ? encodeCursor(last) : null };
}
