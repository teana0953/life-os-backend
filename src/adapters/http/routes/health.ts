import type { Context } from "hono";

export interface HealthHandlerOptions {
  ping: () => Promise<void>;
}

/** Public `GET /health`: reports service + database availability. */
export function createHealthHandler(options: HealthHandlerOptions) {
  return async (c: Context) => {
    try {
      await options.ping();
    } catch {
      return c.json({ ok: false }, 503);
    }
    return c.json({ ok: true });
  };
}
