import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const GOOGLE_SECURETOKEN_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export interface FirebaseClaims {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface VerifyFirebaseTokenOptions {
  projectId: string;
  /** Injectable JWKS source: `createRemoteJWKSet` in prod, `createLocalJWKSet` in tests. */
  jwks: JWTVerifyGetKey;
}

/**
 * Verifies a Firebase ID token's signature against the given JWKS and checks
 * that `aud` equals `projectId` and `iss` equals
 * `https://securetoken.google.com/<projectId>`. Throws if the token is
 * invalid, expired, or has the wrong `aud`/`iss`.
 */
export async function verifyFirebaseToken(
  token: string,
  options: VerifyFirebaseTokenOptions,
): Promise<FirebaseClaims> {
  const { payload } = await jwtVerify(token, options.jwks, {
    issuer: `https://securetoken.google.com/${options.projectId}`,
    audience: options.projectId,
  });

  return {
    uid: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : null,
    displayName: typeof payload.name === "string" ? payload.name : null,
  };
}

/** Production JWKS source: Google's securetoken JWK endpoint. */
export function createGoogleSecuretokenJwks(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(GOOGLE_SECURETOKEN_JWKS_URL));
}
