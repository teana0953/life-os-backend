import { logInternalError } from "../error-logging";

/**
 * One section of a per-screen batch response. The envelope is the contract:
 * a failed section must stay a failed *section*, never a failed request, or
 * batching would turn "one card is empty" into "the whole page failed".
 */
export type Section<T> = { ok: true; data: T } | { ok: false; error: "unavailable" };

/**
 * Backstop fuse, not a tuned budget: sections run in ~8ms against a Neon
 * instance local to the Worker, so anything reaching this is a fault. Without
 * it a single hung query holds the whole screen blank — the failure mode
 * per-section error isolation does not cover, because a hang never rejects.
 */
export const SECTION_TIMEOUT_MS = 8_000;

/**
 * Workers Free plan's subrequests-per-invocation ceiling (docs read
 * 2026-08-20; batch-screen-reads design.md D6). It covers the *whole*
 * invocation, not the fan-out alone, so a batch handler wraps its entire body
 * in `withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, ...)` — the pre-fan-out
 * `resolveUserId` and JWKS fetch spend from the same ceiling. Wrapping only
 * `resolveSections` would miss the fan-out too: `section()`'s thunk starts
 * running synchronously, and `AsyncLocalStorage` only reaches work started
 * inside the scoped callback.
 */
export const FREE_PLAN_SUBREQUEST_LIMIT = 50;

/**
 * Runs one section and resolves to its envelope. The catch is *inside*, so the
 * returned promise never rejects and a `Promise.all` over sections cannot
 * reject either. Failures are logged: isolation without logging turns every
 * section fault into silence.
 */
export async function section<T>(run: () => Promise<T>): Promise<Section<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fuse = new Promise<Section<T>>((resolve) => {
    timer = setTimeout(() => {
      logInternalError(new Error(`section timed out after ${SECTION_TIMEOUT_MS}ms`));
      resolve({ ok: false, error: "unavailable" });
    }, SECTION_TIMEOUT_MS);
  });

  const work = (async (): Promise<Section<T>> => {
    try {
      return { ok: true, data: await run() };
    } catch (err) {
      logInternalError(err);
      return { ok: false, error: "unavailable" };
    }
  })();

  try {
    return await Promise.race([work, fuse]);
  } finally {
    clearTimeout(timer);
  }
}

type SectionMap = Record<string, Promise<Section<unknown>>>;

/**
 * Awaits an object of `key → section promise`. Keying by name rather than by
 * position is deliberate: a positional `allSettled` array has to be re-keyed by
 * index, and that mapping shifts silently when a section is added.
 */
export async function resolveSections<T extends SectionMap>(sections: T): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const entries = await Promise.all(Object.entries(sections).map(async ([key, value]) => [key, await value] as const));
  return Object.fromEntries(entries) as { [K in keyof T]: Awaited<T[K]> };
}

/** The `YYYY-MM` a `YYYY-MM-DD` day falls in. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/**
 * The inclusive `[day − (days − 1), day]` window, in UTC so a DST boundary
 * cannot shift it by a day for callers west of UTC.
 */
export function windowEndingAt(day: string, days: number): { from: string; to: string } {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, dayOfMonth) - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: day };
}
