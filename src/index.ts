import { sql } from "drizzle-orm";
import { createApp } from "./adapters/http/app";
import { DrizzleUserRepository } from "./contexts/user/adapters/drizzle-user-repository";
import { createGoogleSecuretokenJwks } from "./shared/auth/firebase-verifier";
import { createDbClient } from "./shared/db/client";

export interface Env {
  DATABASE_URL: string;
  FIREBASE_PROJECT_ID: string;
}

// Module-scope so the fetched JWKS is cached across requests within a worker instance.
const jwks = createGoogleSecuretokenJwks();

export default {
  fetch(request, env, ctx) {
    const db = createDbClient(env.DATABASE_URL);
    const userRepository = new DrizzleUserRepository(db);

    const app = createApp({
      projectId: env.FIREBASE_PROJECT_ID,
      jwks,
      userRepository,
      ping: async () => {
        await db.execute(sql`select 1`);
      },
    });

    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
