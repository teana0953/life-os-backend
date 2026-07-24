import type { PushMessage, PushSendResult, PushSender } from "../domain/push-sender";
import type { PushSubscription } from "../domain/push-subscription";

export interface WebPushSenderOptions {
  /** VAPID application-server public key: base64url, uncompressed P-256 point (65 bytes). */
  publicKey?: string;
  /** VAPID application-server private key: base64url raw P-256 scalar `d` (32 bytes). */
  privateKey?: string;
  /** VAPID `sub` claim, e.g. "mailto:you@example.com". */
  subject?: string;
  fetchImpl?: typeof fetch;
}

/** How long the push service should hold the message if the device is offline. */
const TTL_SECONDS = 60;
/** VAPID JWT lifetime, well under the RFC8292-recommended 24h ceiling. */
const VAPID_JWT_LIFETIME_SECONDS = 12 * 60 * 60;
/** RFC8188 `rs` (record size): must exceed this record's ciphertext length; our payloads are small. */
const AES128GCM_RECORD_SIZE = 4096;

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// The `@cloudflare/workers-types` ambient types for SubtleCrypto are looser/mis-named
// than the runtime actually is (`generateKey` types as `CryptoKey | CryptoKeyPair`
// regardless of algorithm; ECDH's `deriveBits` "public key" field types as `$public`,
// while workerd's actual Web Crypto implementation — per RFC8291/WebCrypto spec —
// takes `public`, as exercised by this adapter's passing contract test). These two
// small helpers isolate the resulting `as` casts.
async function generateEcKeyPair(algorithm: { name: string; namedCurve: string }, usages: string[]): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(algorithm, true, usages)) as CryptoKeyPair;
}

async function exportRawKeyBytes(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array((await crypto.subtle.exportKey("raw", key)) as ArrayBuffer);
}

async function deriveEcdhSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey, lengthBits: number): Promise<Uint8Array> {
  const algorithm = { name: "ECDH", public: publicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  return new Uint8Array(await crypto.subtle.deriveBits(algorithm, privateKey, lengthBits));
}

/**
 * Driven adapter: sends a Web Push message per RFC8291 (`aes128gcm` payload
 * encryption: ECDH P-256 -> HKDF-SHA256 -> AES-128-GCM) and RFC8292 (VAPID
 * `Authorization` JWT, ES256), built entirely on WebCrypto (`crypto.subtle`) so
 * it runs in the Workers runtime (`workerd`) — no Node `crypto`.
 *
 * Never logs the subscription or its keys, and never throws: any failure
 * (missing VAPID keys, a malformed subscription, or a network/HTTP error)
 * surfaces as `PushSendResult = "failed"`.
 */
export class WebPushSender implements PushSender {
  private readonly publicKey?: string;
  private readonly privateKey?: string;
  private readonly subject?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WebPushSenderOptions) {
    this.publicKey = options.publicKey;
    this.privateKey = options.privateKey;
    this.subject = options.subject;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(subscription: PushSubscription, message: PushMessage): Promise<PushSendResult> {
    if (!this.publicKey || !this.privateKey) return "failed";

    try {
      const [authorization, body] = await Promise.all([
        this.buildVapidAuthorization(subscription.endpoint, this.publicKey, this.privateKey, this.subject ?? ""),
        this.encryptPayload(subscription, JSON.stringify(message)),
      ]);

      const response = await this.fetchImpl(subscription.endpoint, {
        method: "POST",
        headers: {
          TTL: String(TTL_SECONDS),
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "aes128gcm",
          Authorization: authorization,
        },
        body,
      });

      if (response.ok) return "sent";
      if (response.status === 404 || response.status === 410) return "expired";
      return "failed";
    } catch {
      return "failed";
    }
  }

  /** RFC8292: `Authorization: vapid t=<ES256 JWT>, k=<application-server public key>`. */
  private async buildVapidAuthorization(
    endpoint: string,
    publicKey: string,
    privateKey: string,
    subject: string,
  ): Promise<string> {
    const publicKeyBytes = base64UrlDecode(publicKey);
    const x = publicKeyBytes.slice(1, 33);
    const y = publicKeyBytes.slice(33, 65);
    const d = base64UrlDecode(privateKey);

    const signingKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: base64UrlEncode(x), y: base64UrlEncode(y), d: base64UrlEncode(d) },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );

    const header = { typ: "JWT", alg: "ES256" };
    const payload = {
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + VAPID_JWT_LIFETIME_SECONDS,
      sub: subject,
    };
    const encoder = new TextEncoder();
    const signingInput = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(encoder.encode(JSON.stringify(payload)))}`;
    // ECDSA sign() output is IEEE P1363 (raw r||s) — exactly what a JOSE ES256 signature is, no re-encoding needed.
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(signingInput));
    const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

    return `vapid t=${jwt}, k=${publicKey}`;
  }

  /** RFC8291: ECDH (our ephemeral key x subscriber's `p256dh`) -> HKDF-SHA256 -> AES-128-GCM, framed per RFC8188. */
  private async encryptPayload(subscription: PushSubscription, plaintext: string): Promise<Uint8Array> {
    const subscriberPublicBytes = base64UrlDecode(subscription.p256dh);
    const authSecret = base64UrlDecode(subscription.auth);

    const subscriberPublicKey = await crypto.subtle.importKey(
      "raw",
      subscriberPublicBytes,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const ephemeralKeyPair = await generateEcKeyPair({ name: "ECDH", namedCurve: "P-256" }, ["deriveBits"]);
    const ephemeralPublicBytes = await exportRawKeyBytes(ephemeralKeyPair.publicKey);
    const sharedSecret = await deriveEcdhSharedSecret(ephemeralKeyPair.privateKey, subscriberPublicKey, 256);

    const encoder = new TextEncoder();

    // RFC8291 3.4: IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\0" || ua_public || as_public, 32)
    const ikmKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);
    const ikm = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: authSecret,
          info: concatBytes(encoder.encode("WebPush: info\0"), subscriberPublicBytes, ephemeralPublicBytes),
        },
        ikmKey,
        256,
      ),
    );

    // RFC8188 2.1: CEK/NONCE derived from a fresh random salt + the IKM above.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const prkKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const cek = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("Content-Encoding: aes128gcm\0") },
        prkKey,
        128,
      ),
    );
    const nonce = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("Content-Encoding: nonce\0") },
        prkKey,
        96,
      ),
    );

    const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
    // A single, final record: plaintext followed by the RFC8188 "last record" delimiter (0x02).
    const recordPlaintext = concatBytes(encoder.encode(plaintext), new Uint8Array([0x02]));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, recordPlaintext));

    const recordSize = new Uint8Array(4);
    new DataView(recordSize.buffer).setUint32(0, AES128GCM_RECORD_SIZE, false);
    const header = concatBytes(salt, recordSize, new Uint8Array([ephemeralPublicBytes.length]), ephemeralPublicBytes);

    return concatBytes(header, ciphertext);
  }
}
