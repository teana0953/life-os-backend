import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/adapters/http/app";

// Wraps the real `createApp` in a spy (passthrough — it still builds a real
// app) so this file can observe how many times the composition root actually
// reconstructs it, rather than only checking that requests succeed.
vi.mock("../src/adapters/http/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/adapters/http/app")>();
  return { ...actual, createApp: vi.fn(actual.createApp) };
});

import worker from "../src/index";

type FetchParams = Parameters<typeof worker.fetch>;

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as FetchParams[2];

function makeEnv(): FetchParams[1] {
  // Content is irrelevant to these tests — the routes hit never touch the DB
  // — only the object's identity matters for the cache key.
  return {
    DATABASE_URL: "postgres://irrelevant",
    FIREBASE_PROJECT_ID: "life-os-test",
  } as unknown as FetchParams[1];
}

async function call(env: FetchParams[1], path = "/api/me"): Promise<Response> {
  const request = new Request(`https://example.com${path}`, undefined) as unknown as FetchParams[0];
  return worker.fetch(request, env, ctx);
}

const mockedCreateApp = vi.mocked(createApp);

describe("module-scope app/deps cache in the composition root", () => {
  it("does not rebuild the app on a second request with the same env object", async () => {
    const env = makeEnv();
    const callsBefore = mockedCreateApp.mock.calls.length;

    const res1 = await call(env);
    const callsAfterFirst = mockedCreateApp.mock.calls.length;
    expect(callsAfterFirst - callsBefore).toBe(1); // cache miss: builds once

    const res2 = await call(env);
    const callsAfterSecond = mockedCreateApp.mock.calls.length;
    expect(callsAfterSecond - callsAfterFirst).toBe(0); // cache hit: no rebuild

    // Sanity: both requests actually went through the real app (401, no token).
    expect(res1.status).toBe(401);
    expect(res2.status).toBe(401);
  });

  it("rebuilds the app when a request arrives with a different env object", async () => {
    const envA = makeEnv();
    await call(envA);
    const callsAfterA = mockedCreateApp.mock.calls.length;

    // Same field values as envA, but a distinct object — must not hit the
    // cache from envA's request above, or a stale env's secrets would
    // silently keep serving requests carrying a fresh one.
    const envB = makeEnv();
    await call(envB);
    const callsAfterB = mockedCreateApp.mock.calls.length;
    expect(callsAfterB - callsAfterA).toBe(1); // different env identity: rebuild

    // Calling again with envB now hits its own cache entry.
    await call(envB);
    const callsAfterBAgain = mockedCreateApp.mock.calls.length;
    expect(callsAfterBAgain - callsAfterB).toBe(0);
  });
});
