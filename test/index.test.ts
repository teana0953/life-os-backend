import { describe, expect, it, vi } from "vitest";
import worker, { buildDeps, type Env } from "../src/index";
import { remainingSubrequestBudget, withSubrequestBudget } from "../src/shared/db/subrequest-budget";

// A misconfigured DATABASE_URL must never crash the Worker (Cloudflare error
// 1101). The DB client is built lazily inside the Hono error boundary, so a
// bad URL degrades to 503 (/health) or 500 (routes that need the DB) and does
// not affect requests that never touch the DB.
type FetchParams = Parameters<typeof worker.fetch>;

const badEnv = {
  DATABASE_URL: "this-is-not-a-valid-url",
  FIREBASE_PROJECT_ID: "life-os-test",
} as unknown as FetchParams[1];

// The handler schedules no waitUntil work, so a minimal ExecutionContext is enough.
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as FetchParams[2];

async function call(path: string, init?: RequestInit): Promise<Response> {
  const request = new Request(`https://example.com${path}`, init) as unknown as FetchParams[0];
  return worker.fetch(request, badEnv, ctx);
}

describe("Worker composition root with an invalid DATABASE_URL", () => {
  it("returns 401 for /api/me with no token (never constructs the DB client)", async () => {
    const res = await call("/api/me");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 503 from /health instead of crashing the Worker", async () => {
    const res = await call("/health");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe("scheduled handler composition root", () => {
  it("does not throw synchronously with an invalid DATABASE_URL (errors surface inside the waitUntil promise)", () => {
    type ScheduledParams = Parameters<NonNullable<typeof worker.scheduled>>;
    const event = { cron: "* * * * *", scheduledTime: Date.now() } as unknown as ScheduledParams[0];
    const waited: Promise<unknown>[] = [];
    const scheduledCtx = { waitUntil: (p: Promise<unknown>) => waited.push(p), passThroughOnException() {} } as unknown as ScheduledParams[2];

    expect(() => worker.scheduled?.(event, badEnv, scheduledCtx)).not.toThrow();
    // The one deferred promise rejects (bad DATABASE_URL) — assert on it directly
    // instead of leaving an unhandled rejection.
    expect(waited).toHaveLength(1);
    return expect(waited[0]).rejects.toThrow();
  });
});

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A real VAPID key pair + a real subscriber P-256 key pair, so
 * `WebPushSender.send()` runs all the way to its `fetch` call instead of
 * returning `failed` at the crypto step (see `web-push-sender.ts`).
 */
async function realPushEnv(): Promise<Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT"> & { p256dh: string; auth: string }> {
  const vapidKeyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const VAPID_PUBLIC_KEY = base64UrlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", vapidKeyPair.publicKey)) as ArrayBuffer));
  const VAPID_PRIVATE_KEY = ((await crypto.subtle.exportKey("jwk", vapidKeyPair.privateKey)) as JsonWebKey).d ?? "";

  const subscriberKeyPair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = base64UrlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", subscriberKeyPair.publicKey)) as ArrayBuffer));
  const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  return { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT: "mailto:test@example.com", p256dh, auth };
}

/**
 * fix-care-reminder-subrequest-n-plus-1 design.md D3: "a push send is also a
 * fetch, so subscriptions count against the same 50 as the queries." That
 * only holds if the composition root actually wires `WebPushSender`'s
 * `fetchImpl` to `recordSubrequest()` — without it `remainingSubrequestBudget()`
 * never sees a push send at all and over-reports headroom to the care
 * dispatch loop's budget brake.
 */
describe("buildDeps wires WebPushSender's fetch into the subrequest budget", () => {
  it("records one subrequest per push send", async () => {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, p256dh, auth } = await realPushEnv();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    try {
      const { pushSender } = buildDeps({
        DATABASE_URL: "postgres://unused",
        FIREBASE_PROJECT_ID: "life-os-test",
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY,
        VAPID_SUBJECT,
        CARE_REMINDER_WORKFLOW: {} as Env["CARE_REMINDER_WORKFLOW"],
      });

      await withSubrequestBudget(10, async () => {
        expect(remainingSubrequestBudget()).toBe(10);
        const result = await pushSender.send(
          { userId: "user-1", endpoint: "https://push.example.com/probe", p256dh, auth },
          { title: "t", body: "b", ttlSeconds: 300 },
        );
        expect(result.outcome).toBe("sent"); // crypto + the (stubbed) fetch both actually ran.
        expect(remainingSubrequestBudget()).toBe(9);
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
