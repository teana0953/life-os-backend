import { beforeAll, describe, expect, it } from "vitest";
import { WebPushSender } from "../../../src/contexts/notifications/adapters/web-push-sender";
import type { PushMessage } from "../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription } from "../../../src/contexts/notifications/domain/push-subscription";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function fakeFetch(response: Response, calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  }) as typeof fetch;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A real VAPID (application server) EC P-256 key pair, generated once for all tests.
let vapidPublicKey: string;
let vapidPrivateKey: string;

// A real subscriber P-256 key pair + auth secret, standing in for a browser's
// PushSubscription keys (needed so ECDH actually succeeds against a point on the curve).
let subscription: PushSubscription;

// The cases below are about status/credential handling, not about TTL or
// Urgency; MESSAGE carries the now-required `ttlSeconds` so they stay focused.
// The header values themselves are pinned by the dedicated cases at the end.
const MESSAGE: PushMessage = { title: "Test", body: "Body", ttlSeconds: 300 };

beforeAll(async () => {
  // The `@cloudflare/workers-types` ambient types for generateKey/exportKey are
  // looser than the actual runtime shape (see the matching comment in
  // web-push-sender.ts); cast through the real per-format/algorithm result shapes.
  const vapidKeyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const vapidPublicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", vapidKeyPair.publicKey)) as ArrayBuffer);
  const vapidPrivateJwk = (await crypto.subtle.exportKey("jwk", vapidKeyPair.privateKey)) as JsonWebKey;
  vapidPublicKey = base64UrlEncode(vapidPublicRaw);
  vapidPrivateKey = vapidPrivateJwk.d ?? "";

  const subscriberKeyPair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const subscriberPublicRaw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", subscriberKeyPair.publicKey)) as ArrayBuffer,
  );
  const authSecret = crypto.getRandomValues(new Uint8Array(16));

  subscription = {
    id: "sub-1",
    userId: "user-1",
    endpoint: "https://push.example.com/subscription/abc123",
    p256dh: base64UrlEncode(subscriberPublicRaw),
    auth: base64UrlEncode(authSecret),
  };
});

describe("WebPushSender", () => {
  it("POSTs to the subscription endpoint with a TTL header, a vapid Authorization header, and a non-empty body; 201 → sent", async () => {
    const calls: FetchCall[] = [];
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 201 }), calls),
    });

    const result = await sender.send(subscription, MESSAGE);

    expect(result).toEqual({ outcome: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(subscription.endpoint);
    expect(calls[0].init?.method).toBe("POST");
    const headers = new Headers(calls[0].init?.headers);
    // NOT `toBeTruthy()`, which the pre-change hardcoded TTL of 60 also passed:
    // the whole point of moving TTL onto the message is that the caller's number
    // is what goes on the wire, and only an exact value can show that.
    expect(headers.get("TTL")).toBe("300");
    expect(headers.get("Authorization")).toMatch(/^vapid /);
    const body = calls[0].init?.body;
    expect(body).toBeTruthy();
    expect((body as Uint8Array).byteLength ?? (body as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it("sends the caller's ttlSeconds verbatim — a different message yields a different TTL header", async () => {
    // Paired with the case above on purpose: two different `ttlSeconds` must
    // produce two different headers, so collapsing the value back to any single
    // constant fails one of them.
    const calls: FetchCall[] = [];
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 201 }), calls),
    });

    await sender.send(subscription, { title: "Test", body: "Body", ttlSeconds: 600 });

    expect(new Headers(calls[0].init?.headers).get("TTL")).toBe("600");
  });

  it("sends Urgency when the message sets it", async () => {
    const calls: FetchCall[] = [];
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 201 }), calls),
    });

    await sender.send(subscription, { ...MESSAGE, urgency: "high" });

    expect(new Headers(calls[0].init?.headers).get("Urgency")).toBe("high");
  });

  it("omits Urgency entirely when the message does not set it", async () => {
    // RFC8030 5.3 defines an absent Urgency as `normal`, so "no header" and
    // "Urgency: normal" are not the same wire message. A sender that always
    // emitted a value would pass the case above and fail here.
    const calls: FetchCall[] = [];
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 201 }), calls),
    });

    await sender.send(subscription, MESSAGE);

    expect(new Headers(calls[0].init?.headers).has("Urgency")).toBe(false);
  });

  it("encrypts only title/body/data — the transport fields never reach the device", async () => {
    // `ttlSeconds`/`urgency` are instructions to the push service. Serializing
    // the whole message object would ship them inside every payload, growing it
    // and handing the service worker fields nothing reads.
    const calls: FetchCall[] = [];
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 201 }), calls),
    });

    const plaintext = JSON.stringify({ title: "Test", body: "Body", data: { ack: "a".repeat(43) } });
    await sender.send(subscription, { title: "Test", body: "Body", data: { ack: "a".repeat(43) }, ttlSeconds: 300, urgency: "high" });
    const withTransport = calls[0].init?.body as Uint8Array;

    // aes128gcm framing is a fixed 86-byte header plus ciphertext of
    // (plaintext + 1 delimiter byte) + 16-byte GCM tag, so the encrypted length
    // pins the plaintext length exactly — without needing the subscriber key.
    expect(withTransport.byteLength).toBe(86 + new TextEncoder().encode(plaintext).length + 1 + 16);
  });

  it("200 → sent", async () => {
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 200 }), []),
    });

    const result = await sender.send(subscription, MESSAGE);

    expect(result).toEqual({ outcome: "sent" });
  });

  it("404 → expired", async () => {
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 404 }), []),
    });

    const result = await sender.send(subscription, MESSAGE);

    expect(result).toEqual({ outcome: "expired", detail: "status_404" });
  });

  it("410 → expired", async () => {
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 410 }), []),
    });

    const result = await sender.send(subscription, MESSAGE);

    expect(result).toEqual({ outcome: "expired", detail: "status_410" });
  });

  it("another non-2xx status → failed, with the status code as detail", async () => {
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 500 }), []),
    });

    const result = await sender.send(subscription, MESSAGE);

    expect(result).toEqual({ outcome: "failed", detail: "status_500" });
  });

  it("a throwing fetch → failed, detail network (never throws)", async () => {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: throwingFetch,
    });

    const result = await sender.send(subscription, MESSAGE);

    expect(result.outcome).toBe("failed");
    expect(result.detail).toMatch(/^network:/);
  });

  it("falls back to the global fetch (bound for the Workers runtime) when none is injected", async () => {
    // Exercises the default-fetch path (previously only injected fakes ran, so the
    // real `this.fetchImpl(...)` binding — which throws `Illegal invocation` on the
    // deployed edge if the global fetch isn't bound to globalThis — was never hit).
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      calls.push(String(u));
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    try {
      const sender = new WebPushSender({
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey,
        subject: "mailto:test@example.com",
      });
      const result = await sender.send(subscription, MESSAGE);
      expect(result.outcome).toBe("sent");
      expect(calls).toEqual([subscription.endpoint]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("missing VAPID keys → failed, detail no_vapid_config (never throws)", async () => {
    const sender = new WebPushSender({ fetchImpl: fakeFetch(new Response(null, { status: 201 }), []) });

    const result = await sender.send(subscription, MESSAGE);

    expect(result).toEqual({ outcome: "failed", detail: "no_vapid_config" });
  });

  it("missing VAPID subject → failed, detail no_vapid_config (never sends a push a service would reject)", async () => {
    // A deploy that sets the keys but forgets VAPID_SUBJECT would otherwise send a
    // JWT with an empty `sub`, which FCM/Apple reject — a silent on-device failure.
    // Surface it as `failed` instead so the misconfiguration is visible.
    const calls: FetchCall[] = [];
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      fetchImpl: fakeFetch(new Response(null, { status: 201 }), calls),
    });

    const result = await sender.send(subscription, MESSAGE);

    expect(result).toEqual({ outcome: "failed", detail: "no_vapid_config" });
    expect(calls).toHaveLength(0);
  });
});
