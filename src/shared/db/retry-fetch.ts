import { describeQueryShape, isRetryableReadOnlyBody } from "./read-only-query";
import { hasSubrequestBudgetForRetry, recordSubrequest } from "./subrequest-budget";

/**
 * A retrying wrapper for the fetch call the neon HTTP driver makes.
 *
 * Retries happen only when BOTH hold:
 *   1. the failure looks transient (thrown fetch, 429, or any 5xx — Cloudflare's
 *      520-527 included), and
 *   2. the request body is a strictly read-only query (see read-only-query.ts).
 *
 * Writes are never retried. A 520 means "no valid response", not "it did not
 * run", so re-sending an `update ... set stock = stock - n` or an
 * `insert ... on conflict ... returning` could decrement twice or duplicate a
 * ledger row. A failed write therefore still surfaces as a 500 and the user
 * retries by hand — that is the intended trade, not an oversight.
 */
export type RetryingFetchDeps = {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

/** One initial attempt plus RETRY_DELAYS_MS.length retries. */
const RETRY_DELAYS_MS = [0, 200, 600];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 4

/**
 * Delay schedule, derived from the 2026-08-14 12:35 incident (wrangler tail,
 * millisecond timestamps) — NOT from cold-start timings, which were ruled out:
 * the Neon compute was awake throughout that window.
 *
 *   12:35:03.266-.272  six parallel front-page reads all fail with 520
 *   12:35:03.743       the next request succeeds
 *
 * Two things follow. First, everything issued in the same instant fails
 * together, so an immediate retry can easily land inside the same window —
 * hence the first retry is free (0 ms) but the later ones are spaced out.
 * Second, recovery took roughly 470 ms, so the attempt schedule has to reach
 * comfortably past that: attempts land at ~0, ~0, ~200 and ~800 ms, i.e. a
 * total span of 800 ms nominal, 600-1000 ms once jitter is applied — every
 * jittered outcome still stretches past the observed 470 ms.
 *
 * 470 ms is a SINGLE observation, not a statistical upper bound. A longer
 * outage will still fail, and we have no data on how often that happens.
 *
 * Worst case for the user is a read that takes ~800 ms longer and succeeds,
 * which beats a 500. Jitter exists because the six front-page requests fail
 * simultaneously and would otherwise resynchronise onto the same retry instant.
 */
const JITTER_RATIO = 0.25; // +/-25%

function jittered(delayMs: number, random: () => number): number {
  return Math.round(delayMs * (1 + (random() * 2 - 1) * JITTER_RATIO));
}

/** 429 and every 5xx (including Cloudflare's 520-527). 400 is neon's SQL-error
 *  channel and 401/403/404 are deterministic, so none of those are transient. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function describeFailure(outcome: { response?: Response; error?: unknown }): string {
  if (outcome.response) return `http ${outcome.response.status}`;
  const error = outcome.error;
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function createRetryingFetch({ fetchImpl, sleep, random }: RetryingFetchDeps) {
  return async function retryingFetch(url: string, init: RequestInit): Promise<Response> {
    // The body is a plain string (neon JSON.stringify's it), so re-sending the
    // same init is safe — there is no consumed stream to rewind.
    const body = init.body;

    for (let attempt = 1; ; attempt++) {
      recordSubrequest();
      let response: Response | undefined;
      let error: unknown;
      try {
        response = await fetchImpl(url, init);
      } catch (thrown) {
        error = thrown;
      }

      // Success, or a deterministic failure: hand it straight back with its
      // body untouched — neon calls .json()/.text() on it.
      if (response && !isTransientStatus(response.status)) return response;

      const failure = describeFailure({ response, error });
      const shape = describeQueryShape(body);

      if (!isRetryableReadOnlyBody(body)) {
        // The only signal for what the read-only restriction costs us.
        console.warn(`[db] transient failure not retried (body is not read-only): ${failure} shape=${shape}`);
        if (response) return response;
        throw error;
      }

      if (attempt >= MAX_ATTEMPTS) {
        console.warn(`[db] retries exhausted after ${MAX_ATTEMPTS} attempts: ${failure} shape=${shape}`);
        if (response) return response;
        throw error;
      }

      if (!hasSubrequestBudgetForRetry()) {
        // A batch endpoint's fan-out shares one subrequest budget across every
        // section (subrequest-budget.ts) — retrying here could push the whole
        // request over the Workers cap for the sake of one section, taking
        // down sections that would otherwise have succeeded on their first
        // attempt. Give up on this one instead (batch-screen-reads design.md D6).
        console.warn(`[db] retry skipped, request subrequest budget exhausted: ${failure} shape=${shape}`);
        if (response) return response;
        throw error;
      }

      const delayMs = jittered(RETRY_DELAYS_MS[attempt - 1], random);
      console.warn(`[db] transient failure, retrying: attempt ${attempt}/${MAX_ATTEMPTS} ${failure} shape=${shape} delay=${delayMs}ms`);
      await sleep(delayMs);
    }
  };
}
