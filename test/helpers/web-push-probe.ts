import { WebPushSender } from "../../src/contexts/notifications/adapters/web-push-sender";
import type { PushSubscription } from "../../src/contexts/notifications/domain/push-subscription";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface WebPushProbe {
  sender: WebPushSender;
  subscription: PushSubscription;
  /** Every request the sender issued, in order — `headers` is what actually went out. */
  requests: RequestInit[];
}

/**
 * A real `WebPushSender` whose `fetch` is captured, so a caller's intent can be
 * checked against the bytes and headers that reach the push service rather
 * than against the object it handed the port.
 *
 * The keys are genuinely generated, not placeholders: with an invalid `p256dh`
 * the sender's ECDH throws, every send returns `failed`, and no request is
 * issued at all — assertions over `requests` would then be assertions over an
 * empty array, which is how a guard here becomes one that cannot fail.
 */
export async function createWebPushProbe(endpoint = "https://push.example.com/probe"): Promise<WebPushProbe> {
  const vapidKeyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = base64UrlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", vapidKeyPair.publicKey)) as ArrayBuffer));
  const privateKey = ((await crypto.subtle.exportKey("jwk", vapidKeyPair.privateKey)) as JsonWebKey).d ?? "";

  const subscriberKeyPair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = base64UrlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", subscriberKeyPair.publicKey)) as ArrayBuffer));
  const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const requests: RequestInit[] = [];
  const sender = new WebPushSender({
    publicKey,
    privateKey,
    subject: "mailto:test@example.com",
    fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 201 });
    }) as typeof fetch,
  });

  return { sender, subscription: { id: "sub-probe", userId: "user-1", endpoint, p256dh, auth }, requests };
}
