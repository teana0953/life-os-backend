import type { JWTVerifyGetKey } from "jose";
import type { MiddlewareHandler } from "hono";
import { verifyFirebaseToken, type FirebaseClaims } from "../../../shared/auth/firebase-verifier";

export interface AuthVariables {
  firebaseClaims: FirebaseClaims;
}

export interface AuthMiddlewareOptions {
  projectId: string;
  jwks: JWTVerifyGetKey;
}

const BEARER_PREFIX = "Bearer ";

/** Requires a syntactically valid `Authorization: Bearer <token>` header with a verified Firebase ID token. */
export function createAuthMiddleware(
  options: AuthMiddlewareOptions,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }

    try {
      const claims = await verifyFirebaseToken(token, options);
      c.set("firebaseClaims", claims);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}
