import { describe, expect, it } from "vitest";
import worker from "../src/index";

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
