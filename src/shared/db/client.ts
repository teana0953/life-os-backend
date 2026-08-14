import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { createRetryingFetch } from "./retry-fetch";
import * as schema from "./schema";

// Retry transient Neon HTTP failures (see retry-fetch.ts for the schedule and
// the incident data behind it).
//
// This does NOT fix the root cause of the 520s. That cause is still unknown and
// may not be diagnosable from our side: Neon's compute was awake during the
// 2026-08-14 12:35 incident, so it is neither a cold start nor a suspend. All
// this does is downgrade a transient failure from "the user sees a 500" to
// "the request is slower but succeeds" — and only for reads.
//
// Writes are deliberately NOT retried. A 520 means "no valid response", not
// "the statement did not run", so re-sending a write could decrement stock
// twice or duplicate a ledger row. A write that hits a 520 therefore still
// surfaces as a 500 and the user retries by hand. One manual retry beats a
// silent double-charge; that is the intended trade.
//
// The `fetchFunction` hook is global-only in @neondatabase/serverless 1.1.0 —
// it lives on neonConfig, not in neon()'s per-client options (see
// NeonConfigGlobalOnly in the driver's .d.ts). Assigning it here is idempotent
// and this is the only module that constructs Neon clients.
neonConfig.fetchFunction = createRetryingFetch({
  fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
});

export function createDbClient(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDbClient>;
