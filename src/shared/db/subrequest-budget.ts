import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Tracks outbound `neon-http` fetches against a per-request ceiling so
 * `retry-fetch.ts` can stop retrying before a fan-out of many reads (e.g.
 * `/api/health-overview`'s 28) crosses the Workers subrequest cap. Scoped
 * with `AsyncLocalStorage`, not a module-level counter — `getCached` in
 * `index.ts` reuses one `Db`/`fetchFunction` across concurrent requests in
 * the same isolate, so a plain counter would double-count across requests
 * (batch-screen-reads design.md D6).
 */
const storage = new AsyncLocalStorage<{ count: number; limit: number }>();

/** Runs `fn` with a fresh, request-scoped subrequest budget of `limit`. */
export function withSubrequestBudget<T>(limit: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ count: 0, limit }, fn);
}

/**
 * Records one outbound fetch attempt. Outside a scoped request (every route
 * other than the batch endpoints, and most tests) this is a no-op.
 */
export function recordSubrequest(): void {
  const budget = storage.getStore();
  if (budget) budget.count++;
}

/**
 * Whether the current request still has headroom to retry a failed fetch.
 * `true` outside a scoped request, so single-query routes are unaffected.
 */
export function hasSubrequestBudgetForRetry(): boolean {
  const budget = storage.getStore();
  return !budget || budget.count < budget.limit;
}
