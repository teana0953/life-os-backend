import { beforeAll, describe, expect, it } from "vitest";
import { WebPushSender } from "../../../src/contexts/notifications/adapters/web-push-sender";
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

    const result = await sender.send(subscription, { title: "Test", body: "Body" });

    expect(result).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(subscription.endpoint);
    expect(calls[0].init?.method).toBe("POST");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("TTL")).toBeTruthy();
    expect(headers.get("Authorization")).toMatch(/^vapid /);
    const body = calls[0].init?.body;
    expect(body).toBeTruthy();
    expect((body as Uint8Array).byteLength ?? (body as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it("200 → sent", async () => {
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 200 }), []),
    });

    const result = await sender.send(subscription, { title: "Test", body: "Body" });

    expect(result).toBe("sent");
  });

  it("404 → expired", async () => {
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 404 }), []),
    });

    const result = await sender.send(subscription, { title: "Test", body: "Body" });

    expect(result).toBe("expired");
  });

  it("410 → expired", async () => {
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 410 }), []),
    });

    const result = await sender.send(subscription, { title: "Test", body: "Body" });

    expect(result).toBe("expired");
  });

  it("another non-2xx status → failed", async () => {
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: fakeFetch(new Response(null, { status: 500 }), []),
    });

    const result = await sender.send(subscription, { title: "Test", body: "Body" });

    expect(result).toBe("failed");
  });

  it("a throwing fetch → failed (never throws)", async () => {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const sender = new WebPushSender({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: "mailto:test@example.com",
      fetchImpl: throwingFetch,
    });

    const result = await sender.send(subscription, { title: "Test", body: "Body" });

    expect(result).toBe("failed");
  });

  it("missing VAPID keys → failed (never throws)", async () => {
    const sender = new WebPushSender({ fetchImpl: fakeFetch(new Response(null, { status: 201 }), []) });

    const result = await sender.send(subscription, { title: "Test", body: "Body" });

    expect(result).toBe("failed");
  });
});
