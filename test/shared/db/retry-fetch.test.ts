import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetryingFetch } from "../../../src/shared/db/retry-fetch";

const READ_BODY = JSON.stringify({ query: 'select "updated_at" from "body_profile"', params: [] });
const WRITE_BODY = JSON.stringify({ query: 'update "users" set "email" = $1', params: ["a@b.c"] });
const MIXED_BATCH_BODY = JSON.stringify({
  queries: [
    { query: "select 1", params: [] },
    { query: 'insert into "t" ("a") values ($1)', params: [1] },
  ],
});

/** Cloudflare's 520 — the status observed in the incident. */
const transient = (status = 520) => new Response("<html>error 520</html>", { status });
const ok = () => new Response(JSON.stringify({ fields: [], rows: [] }), { status: 200 });

type Outcome = Response | Error;

function harness(outcomes: Outcome[]) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const sleeps: number[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body });
    const outcome = outcomes[calls.length - 1];
    if (outcome === undefined) throw new Error(`fake fetch called ${calls.length} times, only ${outcomes.length} outcomes configured`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const retrying = createRetryingFetch({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    // No jitter, so delays are exactly the nominal schedule.
    random: () => 0.5,
  });
  return { retrying, calls, sleeps, fetchImpl };
}

const send = (retrying: ReturnType<typeof harness>["retrying"], body: string) =>
  retrying("https://ep.neon.tech/sql", { method: "POST", body, headers: {} });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRetryingFetch — retrying reads", () => {
  it("returns the success response after one transient failure", async () => {
    const { retrying, calls } = harness([transient(), ok()]);
    const res = await send(retrying, READ_BODY);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("retries twice when the first two attempts fail", async () => {
    const { retrying, calls } = harness([transient(), transient(502), ok()]);
    const res = await send(retrying, READ_BODY);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("makes at most 4 attempts and returns the last failure", async () => {
    const { retrying, calls } = harness([transient(), transient(), transient(), transient(503)]);
    const res = await send(retrying, READ_BODY);
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(4);
  });

  it("sleeps 0 / 200 / 600 ms between attempts, in that order", async () => {
    const { retrying, sleeps } = harness([transient(), transient(), transient(), transient()]);
    await send(retrying, READ_BODY);
    expect(sleeps).toEqual([0, 200, 600]);
  });

  it("applies +/-25% jitter around each nominal delay", async () => {
    const sleeps: number[] = [];
    const retrying = createRetryingFetch({
      fetchImpl: (async () => transient()) as unknown as typeof fetch,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      random: () => 1, // full positive jitter
    });
    await send(retrying, READ_BODY);
    expect(sleeps).toEqual([0, 250, 750]);
  });

  it("retries a thrown fetch and succeeds", async () => {
    const { retrying, calls } = harness([new TypeError("Network connection lost"), ok()]);
    const res = await send(retrying, READ_BODY);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("rethrows the last error when every attempt throws", async () => {
    const last = new TypeError("Network connection lost (final)");
    const { retrying, calls } = harness([new TypeError("a"), new TypeError("b"), new TypeError("c"), last]);
    await expect(send(retrying, READ_BODY)).rejects.toBe(last);
    expect(calls).toHaveLength(4);
  });

  it("retries 429", async () => {
    const { retrying, calls } = harness([new Response("slow down", { status: 429 }), ok()]);
    expect((await send(retrying, READ_BODY)).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("resends the identical body on every attempt", async () => {
    const { retrying, calls } = harness([transient(), ok()]);
    await send(retrying, READ_BODY);
    expect(calls.map((c) => c.body)).toEqual([READ_BODY, READ_BODY]);
  });
});

describe("createRetryingFetch — failures that must not be retried", () => {
  it("never retries 400 (neon's SQL-error channel)", async () => {
    const { retrying, calls } = harness([new Response(JSON.stringify({ message: "syntax error" }), { status: 400 })]);
    const res = await send(retrying, READ_BODY);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("never retries 401 or 404", async () => {
    for (const status of [401, 404]) {
      const { retrying, calls } = harness([new Response("nope", { status })]);
      expect((await send(retrying, READ_BODY)).status).toBe(status);
      expect(calls).toHaveLength(1);
    }
  });

  it("returns 2xx without retrying", async () => {
    const { retrying, calls } = harness([ok()]);
    expect((await send(retrying, READ_BODY)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("never retries a write, even on a transient failure", async () => {
    const { retrying, calls } = harness([transient()]);
    const res = await send(retrying, WRITE_BODY);
    expect(res.status).toBe(520);
    expect(calls).toHaveLength(1);
  });

  it("never retries a batch containing a single write", async () => {
    const { retrying, calls } = harness([transient()]);
    expect((await send(retrying, MIXED_BATCH_BODY)).status).toBe(520);
    expect(calls).toHaveLength(1);
  });

  it("never retries a thrown fetch for a write", async () => {
    const thrown = new TypeError("Network connection lost");
    const { retrying, calls } = harness([thrown]);
    await expect(send(retrying, WRITE_BODY)).rejects.toBe(thrown);
    expect(calls).toHaveLength(1);
  });
});

describe("createRetryingFetch — the returned response body is never consumed", () => {
  it("leaves the success body readable for the neon driver", async () => {
    const { retrying } = harness([transient(), ok()]);
    const res = await send(retrying, READ_BODY);
    expect(res.bodyUsed).toBe(false);
    await expect(res.json()).resolves.toEqual({ fields: [], rows: [] });
  });

  it("leaves the final failure body readable so neon can build its error message", async () => {
    const { retrying } = harness([transient(), transient(), transient(), transient()]);
    const res = await send(retrying, READ_BODY);
    expect(res.bodyUsed).toBe(false);
    await expect(res.text()).resolves.toBe("<html>error 520</html>");
  });

  it("leaves a non-retried write failure body readable", async () => {
    const { retrying } = harness([transient()]);
    const res = await send(retrying, WRITE_BODY);
    expect(res.bodyUsed).toBe(false);
    await expect(res.text()).resolves.toBe("<html>error 520</html>");
  });
});

describe("createRetryingFetch — logging", () => {
  it("warns on each retry with attempt, status, delay and a shape-only descriptor", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { retrying } = harness([transient(), ok()]);
    await send(retrying, READ_BODY);
    const line = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(line).toContain("attempt 1/4");
    expect(line).toContain("520");
    expect(line).toContain("0ms");
    expect(line).toContain("select x1");
    expect(line).not.toContain("body_profile");
    expect(line).not.toContain("updated_at");
  });

  it("warns when retries are exhausted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { retrying } = harness([transient(), transient(), transient(), transient()]);
    await send(retrying, READ_BODY);
    const lines = warn.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("exhausted"))).toBe(true);
    expect(lines.filter((l) => l.includes("exhausted"))).toHaveLength(1);
  });

  it("warns distinctly when a transient failure was not retried because the body writes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { retrying } = harness([transient()]);
    await send(retrying, WRITE_BODY);
    const lines = warn.mock.calls.map((c) => c.join(" "));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not retried");
    expect(lines[0]).toContain("update x1");
    expect(lines[0]).not.toContain("exhausted");
  });

  it("does not warn on a plain success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { retrying } = harness([ok()]);
    await send(retrying, READ_BODY);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn on a deterministic 400", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { retrying } = harness([new Response("{}", { status: 400 })]);
    await send(retrying, READ_BODY);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs the error name and message when the failure was a thrown fetch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { retrying } = harness([new TypeError("Network connection lost"), ok()]);
    await send(retrying, READ_BODY);
    const line = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).toContain("TypeError");
    expect(line).toContain("Network connection lost");
  });
});
