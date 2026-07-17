import { Hono } from "hono";
import { cors } from "hono/cors";
import type { JWTVerifyGetKey } from "jose";
import type { UserRepository } from "../../contexts/user/domain/user-repository";
import { createAuthMiddleware, type AuthVariables } from "./middleware/auth";
import { createHealthHandler } from "./routes/health";
import { createMeHandler } from "./routes/me";

/**
 * Allows the Flutter web client: any localhost port during local development,
 * plus one configured production origin (the deployed Cloudflare Pages URL).
 */
function isAllowedOrigin(origin: string, productionOrigin?: string): boolean {
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return productionOrigin !== undefined && productionOrigin !== "" && origin === productionOrigin;
}

export interface CreateAppOptions {
  projectId: string;
  jwks: JWTVerifyGetKey;
  userRepository: UserRepository;
  ping: () => Promise<void>;
  /** Deployed web app origin (Cloudflare Pages) to allow via CORS, in addition to localhost. */
  allowedWebOrigin?: string;
}

/** Composes the Hono app (driving adapter): routes, auth middleware, and the uniform error handler. */
export function createApp(options: CreateAppOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Browser clients (Flutter web) are cross-origin; allow localhost during dev
  // and permit the Authorization header + preflight for GET requests.
  app.use(
    "*",
    cors({
      origin: (origin) => (isAllowedOrigin(origin, options.allowedWebOrigin) ? origin : null),
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
    }),
  );

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/health", createHealthHandler({ ping: options.ping }));

  const authMiddleware = createAuthMiddleware({ projectId: options.projectId, jwks: options.jwks });
  app.get("/api/me", authMiddleware, createMeHandler({ userRepository: options.userRepository }));

  return app;
}
