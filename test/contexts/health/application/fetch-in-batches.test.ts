import { describe, expect, it } from "vitest";
import { fetchInBatches } from "../../../../src/contexts/health/application/fetch-in-batches";
import type { ChaodaysSession } from "../../../../src/contexts/health/domain/chaodays-client";
import { ChaodaysUpstreamError } from "../../../../src/contexts/health/domain/chaodays-client";
import { CHAODAYS_BATCH_DAYS, splitDateRange } from "../../../../src/contexts/health/domain/date-range-batches";

const INITIAL_SESSION: ChaodaysSession = { accessToken: "token-0", client: "client-0", uid: "uid-1" };

/**
 * A fake fetch that records every call and — crucially — returns a *different*
 * session each time. If it echoed the session it was handed, or returned one
 * fixed session, the "each batch uses the previous response's session"
 * assertion below would pass even against an implementation that always passes
 * the initial session.
 */
function makeFakeFetch(recordsFor: (from: string, to: string) => string[] = (from) => [from]) {
  const calls: { session: ChaodaysSession; from: string; to: string }[] = [];
  let rotation = 0;
  const fetchBatch = async (session: ChaodaysSession, from: string, to: string) => {
    calls.push({ session, from, to });
    rotation++;
    return {
      session: { accessToken: `token-${rotation}`, client: `client-${rotation}`, uid: "uid-1" },
      records: recordsFor(from, to),
    };
  };
  return { calls, fetchBatch };
}

/** A range spanning `batches` batches: the last one is a single day. */
function rangeSpanning(from: string, batches: number): string {
  const [year, month, date] = from.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + CHAODAYS_BATCH_DAYS * (batches - 1))).toISOString().slice(0, 10);
}

describe("fetchInBatches", () => {
  it("makes a single call with the whole range when it fits in one batch", async () => {
    const { calls, fetchBatch } = makeFakeFetch();

    const records = await fetchInBatches(INITIAL_SESSION, "2026-07-01", "2026-07-10", fetchBatch);

    expect(calls).toHaveLength(1);
    expect(calls[0].session).toEqual(INITIAL_SESSION);
    expect({ from: calls[0].from, to: calls[0].to }).toEqual({ from: "2026-07-01", to: "2026-07-10" });
    expect(records).toEqual(["2026-07-01"]);
  });

  it("calls once per batch, in order, with the sub-ranges the splitter produced", async () => {
    const { calls, fetchBatch } = makeFakeFetch();
    const to = rangeSpanning("2026-01-01", 3);

    await fetchInBatches(INITIAL_SESSION, "2026-01-01", to, fetchBatch);

    const expectedBatches = splitDateRange("2026-01-01", to);
    expect(expectedBatches).toHaveLength(3);
    expect(calls.map((call) => ({ from: call.from, to: call.to }))).toEqual(expectedBatches);
  });

  it("presents the session returned by the previous response, not the sign-in session", async () => {
    const { calls, fetchBatch } = makeFakeFetch();
    const to = rangeSpanning("2026-01-01", 3);

    await fetchInBatches(INITIAL_SESSION, "2026-01-01", to, fetchBatch);

    expect(calls).toHaveLength(3);
    expect(calls[0].session).toEqual(INITIAL_SESSION);
    expect(calls[1].session).toEqual({ accessToken: "token-1", client: "client-1", uid: "uid-1" });
    expect(calls[2].session).toEqual({ accessToken: "token-2", client: "client-2", uid: "uid-1" });
  });

  it("concatenates the batches' records in batch order", async () => {
    const { fetchBatch } = makeFakeFetch((from, to) => [`${from}:a`, `${to}:b`]);
    const to = rangeSpanning("2026-01-01", 2);

    const records = await fetchInBatches(INITIAL_SESSION, "2026-01-01", to, fetchBatch);

    const [first, second] = splitDateRange("2026-01-01", to);
    expect(records).toEqual([`${first.from}:a`, `${first.to}:b`, `${second.from}:a`, `${second.to}:b`]);
  });

  it("propagates a batch failure and stops issuing further batches", async () => {
    const calls: string[] = [];
    const failure = new ChaodaysUpstreamError("status_403");
    const fetchBatch = async (session: ChaodaysSession, from: string, _to: string) => {
      calls.push(from);
      if (calls.length === 2) throw failure;
      return { session, records: [from] };
    };
    const to = rangeSpanning("2026-01-01", 4);

    await expect(fetchInBatches(INITIAL_SESSION, "2026-01-01", to, fetchBatch)).rejects.toBe(failure);
    expect(calls).toHaveLength(2);
  });
});
