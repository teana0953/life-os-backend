import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import type { UserRepository } from "../../contexts/user/domain/user-repository";
import { createAuthMiddleware, type AuthVariables } from "./middleware/auth";
import { createHealthHandler } from "./routes/health";
import { createMeHandler } from "./routes/me";

export interface CreateAppOptions {
  projectId: string;
  jwks: JWTVerifyGetKey;
  userRepository: UserRepository;
  ping: () => Promise<void>;
}

/** Composes the Hono app (driving adapter): routes, auth middleware, and the uniform error handler. */
export function createApp(options: CreateAppOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/health", createHealthHandler({ ping: options.ping }));

  const authMiddleware = createAuthMiddleware({ projectId: options.projectId, jwks: options.jwks });
  app.get("/api/me", authMiddleware, createMeHandler({ userRepository: options.userRepository }));

  return app;
}
