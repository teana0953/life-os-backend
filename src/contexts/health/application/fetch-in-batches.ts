import type { ChaodaysSession } from "../domain/chaodays-client";
import { splitDateRange } from "../domain/date-range-batches";

/**
 * Fetches `[from, to]` from chaodays as consecutive batches, so a range too
 * long for one upstream request still succeeds.
 *
 * Sign-in stays a single call: each `fetchBatch` response returns the rotated
 * devise session, which is carried into the next batch. Batches run in sequence
 * for that reason. A failing batch propagates as-is — no retry, no partial
 * result — so the caller's error contract and its "write only after everything
 * is fetched" shape are unchanged.
 *
 * `fetchBatch` adapts a `ChaodaysClient.fetch*` method; the one returning
 * `menus` is adapted by its caller to the `records` shape.
 */
export async function fetchInBatches<T>(
  session: ChaodaysSession,
  from: string,
  to: string,
  fetchBatch: (
    session: ChaodaysSession,
    from: string,
    to: string,
  ) => Promise<{ session: ChaodaysSession; records: T[] }>,
): Promise<T[]> {
  let currentSession = session;
  const all: T[] = [];
  for (const batch of splitDateRange(from, to)) {
    const result = await fetchBatch(currentSession, batch.from, batch.to);
    currentSession = result.session;
    all.push(...result.records);
  }
  return all;
}
