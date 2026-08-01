/** 32 random bytes — high enough entropy that the hash needs no brute-force hardening. */
const TOKEN_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** A fresh invite token (base64url). Returned to its creator once and never stored in plaintext. */
export function generateInviteToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * The stored form of an invite token: a **deterministic, unsalted** SHA-256
 * hex digest. Determinism is a hard requirement, not a shortcut — lookup is
 * `WHERE token_hash = hashInviteToken(token)` and the column carries a unique
 * index, so a salted KDF (bcrypt/argon2) would break both. The token is 32
 * random bytes, so there is nothing to brute-force (add-friends/design.md).
 */
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}
