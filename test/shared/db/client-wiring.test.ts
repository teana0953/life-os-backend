import { neonConfig } from "@neondatabase/serverless";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient } from "../../../src/shared/db/client";
import * as schema from "../../../src/shared/db/schema";

/**
 * THE wiring guard.
 *
 * neon-integration.test.ts proves the retry mechanism works when it is mounted;
 * it mounts `createRetryingFetch` on `neonConfig.fetchFunction` itself and never
 * imports client.ts. So it stays green even if production code never mounts
 * anything — which is the exact shape of failure this backend has shipped three
 * times: 1500+ green tests, feature completely inert in production.
 *
 * This file instead imports the real `createDbClient`, which is what executes
 * client.ts's module-level `neonConfig.fetchFunction = ...`, and then drives a
 * real drizzle read through it. Delete that assignment and both tests below go
 * red with `Server error (HTTP status 520)`.
 *
 * The stub works on `globalThis.fetch` because client.ts wires the late-bound
 * `(...args) => fetch(...args)` rather than capturing `fetch` at module load.
 */

const DATABASE_URL = "postgresql://user:pass@ep-fake-1.us-east-2.aws.neon.tech/lifeos";

const usersPayload = {
  fields: [
    { name: "id", dataTypeID: 2950 },
    { name: "firebase_uid", dataTypeID: 25 },
    { name: "email", dataTypeID: 25 },
    { name: "display_name", dataTypeID: 25 },
    { name: "timezone", dataTypeID: 25 },
    { name: "is_admin", dataTypeID: 16 },
    { name: "created_at", dataTypeID: 1184 },
  ],
  rows: [
    [
      "11111111-1111-1111-1111-111111111111",
      "firebase-abc",
      "a@b.c",
      null,
      "Asia/Taipei",
      "t",
      "2026-08-14 04:35:03.266+00",
    ],
  ],
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client.ts actually mounts the retrying fetch on the neon driver", () => {
  it("declares a fetchFunction on neonConfig once client.ts is loaded", () => {
    expect(neonConfig.fetchFunction).toBeTypeOf("function");
  });

  it("a read issued through createDbClient survives a 520 without any test-local wiring", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      if (attempts === 1) return new Response("error code: 520", { status: 520 });
      return new Response(JSON.stringify(usersPayload), { status: 200 });
    });

    const rows = await createDbClient(DATABASE_URL).select().from(schema.users);

    // 2, not 1: the second attempt only happens because production code — not
    // this test — installed the retrying fetch.
    expect(attempts).toBe(2);
    expect(rows[0].firebaseUid).toBe("firebase-abc");
  });
});
