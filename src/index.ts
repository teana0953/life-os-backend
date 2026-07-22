import { sql } from "drizzle-orm";
import { createApp } from "./adapters/http/app";
import { DrizzleBowelRepository } from "./contexts/health/adapters/drizzle-bowel-repository";
import { DrizzleDailyTargetRepository } from "./contexts/health/adapters/drizzle-daily-target-repository";
import { DrizzleFoodDictionaryRepository } from "./contexts/health/adapters/drizzle-food-dictionary-repository";
import { DrizzleMealRepository } from "./contexts/health/adapters/drizzle-meal-repository";
import { DrizzleVitalsRepository } from "./contexts/health/adapters/drizzle-vitals-repository";
import { DrizzleWaterRepository } from "./contexts/health/adapters/drizzle-water-repository";
import { DrizzleUserRepository } from "./contexts/user/adapters/drizzle-user-repository";
import { createGoogleSecuretokenJwks } from "./shared/auth/firebase-verifier";
import { createDbClient, type Db } from "./shared/db/client";

export interface Env {
  DATABASE_URL: string;
  FIREBASE_PROJECT_ID: string;
  /** Optional deployed web app origin (Cloudflare Pages) to allow via CORS. */
  ALLOWED_WEB_ORIGIN?: string;
}

// Module-scope so the fetched JWKS is cached across requests within a worker instance.
const jwks = createGoogleSecuretokenJwks();

export default {
  fetch(request, env, ctx) {
    // Build the DB client lazily on first use (memoized per request). neon()
    // throws on a malformed DATABASE_URL; deferring construction to inside the
    // Hono handlers keeps that error within the error boundary (→ 503 on
    // /health, 500 on DB-backed routes) instead of throwing in the raw fetch
    // handler and crashing the Worker (Cloudflare error 1101). Requests that
    // never touch the DB (e.g. an unauthenticated /api/me) are unaffected.
    let db: Db | undefined;
    const getDb = () => (db ??= createDbClient(env.DATABASE_URL));

    const userRepository = new DrizzleUserRepository(getDb);
    const foodDictionaryRepository = new DrizzleFoodDictionaryRepository(getDb);
    const mealRepository = new DrizzleMealRepository(getDb);
    const dailyTargetRepository = new DrizzleDailyTargetRepository(getDb);
    const waterRepository = new DrizzleWaterRepository(getDb);
    const bowelRepository = new DrizzleBowelRepository(getDb);
    const vitalsRepository = new DrizzleVitalsRepository(getDb);

    const app = createApp({
      projectId: env.FIREBASE_PROJECT_ID,
      jwks,
      userRepository,
      foodDictionaryRepository,
      mealRepository,
      dailyTargetRepository,
      waterRepository,
      bowelRepository,
      vitalsRepository,
      allowedWebOrigin: env.ALLOWED_WEB_ORIGIN,
      ping: async () => {
        await getDb().execute(sql`select 1`);
      },
    });

    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
