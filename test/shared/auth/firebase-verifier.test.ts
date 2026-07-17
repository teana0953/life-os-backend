import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyFirebaseToken } from "../../../src/shared/auth/firebase-verifier";

const PROJECT_ID = "life-os-test";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KEY_ID = "test-key-1";

let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;

async function signToken(overrides: {
  key?: CryptoKey;
  kid?: string;
  aud?: string;
  iss?: string;
  exp?: string;
  sub?: string;
  email?: string;
  name?: string;
}): Promise<string> {
  return new SignJWT({
    email: overrides.email ?? "alice@example.com",
    name: overrides.name ?? "Alice",
  })
    .setProtectedHeader({ alg: "RS256", kid: overrides.kid ?? KEY_ID })
    .setSubject(overrides.sub ?? "uid-1")
    .setIssuedAt()
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? PROJECT_ID)
    .setExpirationTime(overrides.exp ?? "1h")
    .sign(overrides.key ?? signingKey);
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  signingKey = privateKey;
  const jwk = await exportJWK(publicKey);
  jwk.kid = KEY_ID;
  jwk.alg = "RS256";
  jwk.use = "sig";
  const keySet: JSONWebKeySet = { keys: [jwk] };
  jwks = createLocalJWKSet(keySet);
});

describe("verifyFirebaseToken", () => {
  it("resolves verified claims for a valid token", async () => {
    const token = await signToken({});

    const claims = await verifyFirebaseToken(token, { projectId: PROJECT_ID, jwks });

    expect(claims.uid).toBe("uid-1");
    expect(claims.email).toBe("alice@example.com");
    expect(claims.displayName).toBe("Alice");
  });

  it("rejects an expired token", async () => {
    const token = await signToken({ exp: "-10s" });

    await expect(verifyFirebaseToken(token, { projectId: PROJECT_ID, jwks })).rejects.toThrow();
  });

  it("rejects a token with the wrong audience", async () => {
    const token = await signToken({ aud: "some-other-project" });

    await expect(verifyFirebaseToken(token, { projectId: PROJECT_ID, jwks })).rejects.toThrow();
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = await signToken({ iss: "https://securetoken.google.com/some-other-project" });

    await expect(verifyFirebaseToken(token, { projectId: PROJECT_ID, jwks })).rejects.toThrow();
  });

  it("rejects a token signed by a key not present in the JWKS", async () => {
    const { privateKey: otherKey } = await generateKeyPair("RS256");
    const token = await signToken({ key: otherKey, kid: "not-in-jwks" });

    await expect(verifyFirebaseToken(token, { projectId: PROJECT_ID, jwks })).rejects.toThrow();
  });
});
