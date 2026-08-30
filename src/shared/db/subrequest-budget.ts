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

/**
 * Workers Free plan's subrequests-per-invocation ceiling (docs read
 * 2026-08-20; batch-screen-reads design.md D6). It covers the *whole*
 * invocation, not the fan-out alone, so a batch handler wraps its entire body
 * in `withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, ...)` — the pre-fan-out
 * `resolveUserId` and JWKS fetch spend from the same ceiling. Wrapping only
 * `resolveSections` would miss the fan-out too: `section()`'s thunk starts
 * running synchronously, and `AsyncLocalStorage` only reaches work started
 * inside the scoped callback.
 *
 * It lives next to the mechanism it parameterises rather than in the HTTP
 * route that first needed it, because the notifications context now scopes
 * its Workflows steps with it too and importing an HTTP route from a context
 * would invert this codebase's dependency direction
 * (fix-care-reminder-subrequest-n-plus-1 design.md D3).
 */
export const FREE_PLAN_SUBREQUEST_LIMIT = 50;

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

/**
 * Subrequests still available in the current scope, or `null` outside one.
 * `null` — rather than `Infinity` — so a caller weighing a planned fan-out
 * against the ceiling must decide explicitly what "no budget in force" means
 * for it, instead of silently comparing against a number that is always big
 * enough.
 */
export function remainingSubrequestBudget(): number | null {
  const budget = storage.getStore();
  if (!budget) return null;
  return Math.max(0, budget.limit - budget.count);
}
