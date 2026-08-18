/**
 * One-time delivery-ack tokens. A token is minted per (occurrence x
 * subscription) send and travels ONLY inside the RFC8291-encrypted push
 * payload, so possession of it is itself the proof that the holder is the
 * device that subscription belongs to — the service worker has no Firebase ID
 * token while the app is closed, which is exactly the situation an ack has to
 * work in.
 *
 * Because it is a bearer capability, the database stores only `hashAckToken`'s
 * output: a leaked backup or a row printed into a diagnostic must not yield a
 * usable token.
 */

/** 256 bits: guessing is not a threat model at this width, so `/api/push/ack` needs no rate limit for confidentiality (flooding is a separate, operational concern). */
const ACK_TOKEN_BYTES = 32;

/** The exact shape `mintAckToken` produces: 32 bytes base64url-encoded, unpadded. Checked before any DB work is done for a submitted ack. */
export const ACK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function mintAckToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(ACK_TOKEN_BYTES)));
}

/** SHA-256, lowercase hex — what `push_delivery.token_hash` holds and what the ack lookup matches on. */
export async function hashAckToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
