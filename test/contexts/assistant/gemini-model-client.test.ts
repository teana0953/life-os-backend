import { describe, expect, it } from "vitest";
import { GeminiModelClient } from "../../../src/contexts/assistant/adapters/gemini-model-client";
import { ModelFailure, type AssistantTool } from "../../../src/contexts/assistant/domain/model-client";

/**
 * Every call goes through an injected fake fetch — no test here touches the
 * network (task 6.2). The fake captures the request so the tests can assert
 * what would have left the process.
 */

const KEY = "SECRET-KEY-c4n4ry";

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function clientCapturing(response: Response): { client: GeminiModelClient; captured: () => Captured } {
  let captured: Captured | null = null;
  const client = new GeminiModelClient(async (input, init) => {
    captured = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    return response;
  });
  return {
    client,
    captured: () => {
      if (captured === null) throw new Error("fetch was never called");
      return captured;
    },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TEXT_REPLY = { candidates: [{ content: { parts: [{ text: "hi" }] } }] };

const A_TOOL: AssistantTool = {
  name: "get_monthly_summary",
  description: "sum",
  parameters: { type: "object", properties: {} },
};

describe("where the key travels", () => {
  it("sends it in the x-goog-api-key header and never in the URL", async () => {
    const { client, captured } = clientCapturing(json(200, TEXT_REPLY));

    await client.turn(KEY, "sys", [{ role: "user", content: "q" }], [A_TOOL], []);

    // Both halves matter: moving to `?key=` (the provider's own example)
    // fails the header assertion and the URL assertion at once.
    expect(captured().headers.get("x-goog-api-key")).toBe(KEY);
    expect(captured().url).not.toContain(KEY);
    // The model name is a constant that defines the whole contract — tool
    // calling and token signatures are model-specific behaviour. An
    // accidental revert (e.g. merge conflict misresolution) would ship the
    // old `gemini-2.5-flash`, which gives a 404 to new accounts. This guard
    // catches that: the URL must include the model we built the adapter for.
    // This is a change-detector, which is normally avoided, but here the
    // constant IS the contract.
    expect(captured().url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
  });
});

describe("mapping the neutral types to Gemini", () => {
  it("sends system, roles, tools and tool rounds in Gemini's shapes", async () => {
    const { client, captured } = clientCapturing(json(200, TEXT_REPLY));

    await client.turn(
      KEY,
      "the system prompt",
      [
        { role: "user", content: "question" },
        { role: "assistant", content: "earlier answer" },
      ],
      [A_TOOL],
      [
        {
          calls: [{ id: "get_monthly_summary#0", name: "get_monthly_summary", arguments: { month: "2026-08" } }],
          results: [{ id: "get_monthly_summary#0", name: "get_monthly_summary", result: 42 }],
        },
      ],
    );

    const body = captured().body;
    expect(body.systemInstruction).toEqual({ parts: [{ text: "the system prompt" }] });
    expect(body.tools).toEqual([{ functionDeclarations: [A_TOOL] }]);
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "question" }] },
      // "assistant" is the neutral name; Gemini's is "model".
      { role: "model", parts: [{ text: "earlier answer" }] },
      // A round replays as the model's own functionCall turn followed by the
      // matching functionResponse turn — Gemini rejects results that arrive
      // without the call that asked for them.
      { role: "model", parts: [{ functionCall: { name: "get_monthly_summary", args: { month: "2026-08" } } }] },
      // A non-object result is wrapped: functionResponse.response must be an object.
      { role: "user", parts: [{ functionResponse: { name: "get_monthly_summary", response: { result: 42 } } }] },
    ]);
  });

  it("splits a mixed reply into prose and tool calls, minting ids Gemini does not provide", async () => {
    const { client } = clientCapturing(
      json(200, {
        candidates: [
          {
            content: {
              parts: [
                { text: "Let me check. " },
                { functionCall: { name: "get_monthly_summary", args: { month: "2026-08" } } },
                { functionCall: { name: "list_categories", args: {} } },
                { text: "One moment." },
              ],
            },
          },
        ],
      }),
    );

    const turn = await client.turn(KEY, "sys", [{ role: "user", content: "q" }], [A_TOOL], []);

    expect(turn.text).toBe("Let me check. One moment.");
    expect(turn.toolCalls).toEqual([
      { id: "get_monthly_summary#0", name: "get_monthly_summary", arguments: { month: "2026-08" } },
      { id: "list_categories#1", name: "list_categories", arguments: {} },
    ]);
  });
});

/**
 * Gemini 3 attaches an opaque `thoughtSignature` to each `functionCall` part
 * and rejects the replay of a call that comes back without its own —
 * `400 INVALID_ARGUMENT`, verified against the live API. Dropping it does not
 * degrade the assistant, it ends every tool loop on round two, so these guard
 * the whole path: read off the right part, carried on the neutral type,
 * handed back byte-for-byte.
 */
describe("the provider's opaque per-call token", () => {
  const SIG_A = "sig-AAAA-first-call";
  const SIG_B = "sig-BBBB-second-call";
  const SIG_C = "sig-CCCC-third-call";
  const SIG_D = "sig-DDDD-fourth-call";
  const SIG_TEXT = "sig-TEXT-not-a-call";

  const TWO_SIGNED_CALLS = {
    candidates: [
      {
        content: {
          parts: [
            // A signed *text* part too: it is not a call, so its token must
            // not end up on either call below.
            { text: "checking. ", thoughtSignature: SIG_TEXT },
            { functionCall: { name: "get_monthly_summary", args: { month: "2026-08" } }, thoughtSignature: SIG_A },
            // A call with no signature in the middle: this kills the "by
            // sequence index" mutation (M5) by shifting all indices after it.
            // The same function name repeated with different arguments kills
            // the "by call name" mutation (M4): both get_monthly_summary calls
            // would map to the same signature if reading off a name→signature
            // map instead of the part.
            { functionCall: { name: "list_categories", args: {} } },
            { functionCall: { name: "get_monthly_summary", args: { month: "2026-09" } }, thoughtSignature: SIG_B },
          ],
        },
      },
    ],
  };

  it("comes off the same part as the call it belongs to — each call its own", async () => {
    const { client } = clientCapturing(json(200, TWO_SIGNED_CALLS));

    const turn = await client.turn(KEY, "sys", [{ role: "user", content: "q" }], [A_TOOL], []);

    // Three calls with mixed signatures: the middle one has none. Matching by
    // name would give the second get_monthly_summary SIG_A instead of SIG_B
    // (both map to the same key). Matching by sequence index would give the
    // second call (list_categories) SIG_A — off by one (actually off by where
    // the missing token is in the sequence). Only reading each signature off
    // its own part passes.
    expect(turn.toolCalls).toEqual([
      {
        id: "get_monthly_summary#0",
        name: "get_monthly_summary",
        arguments: { month: "2026-08" },
        providerToken: SIG_A,
      },
      { id: "list_categories#1", name: "list_categories", arguments: {} },
      {
        id: "get_monthly_summary#2",
        name: "get_monthly_summary",
        arguments: { month: "2026-09" },
        providerToken: SIG_B,
      },
    ]);
  });

  it("goes back verbatim, on the replayed call's own part — both rounds", async () => {
    const { client, captured } = clientCapturing(json(200, TEXT_REPLY));

    // Two rounds with distinct signatures: a three-turn tool loop needs the
    // second round's tokens when it plays back, but a one-round test cannot
    // catch a mutation that only assigns tokens to the first round.
    await client.turn(
      KEY,
      "sys",
      [{ role: "user", content: "q" }],
      [A_TOOL],
      [
        {
          calls: [
            { id: "a#0", name: "get_monthly_summary", arguments: { month: "2026-08" }, providerToken: SIG_A },
            { id: "b#1", name: "list_categories", arguments: {}, providerToken: SIG_B },
          ],
          results: [
            { id: "a#0", name: "get_monthly_summary", result: 42 },
            { id: "b#1", name: "list_categories", result: ["food"] },
          ],
        },
        // Round 2 mirrors the shape the *parse* side is hardened against —
        // a repeated call name and a call with no token of its own. Without
        // it, rebuilding the replayed parts from a name→token map, or from a
        // compacted queue of the round's tokens, is green on the replay side
        // while being the very mistake the parse side proves fatal.
        {
          calls: [
            { id: "c#2", name: "get_monthly_summary", arguments: { month: "2026-09" }, providerToken: SIG_C },
            { id: "d#3", name: "list_categories", arguments: {} },
            { id: "e#4", name: "get_monthly_summary", arguments: { month: "2026-10" }, providerToken: SIG_D },
          ],
          results: [
            { id: "c#2", name: "get_monthly_summary", result: 50 },
            { id: "d#3", name: "list_categories", result: ["exercise"] },
            { id: "e#4", name: "get_monthly_summary", result: 7 },
          ],
        },
      ],
    );

    // Whole-shape equality, not "the body mentions SIG_A somewhere": the
    // failure this guards against is the token landing on the wrong part.
    const contents = captured().body.contents as unknown[];
    // First round's model turn: contains[1]
    expect(contents[1]).toEqual({
      role: "model",
      parts: [
        { functionCall: { name: "get_monthly_summary", args: { month: "2026-08" } }, thoughtSignature: SIG_A },
        { functionCall: { name: "list_categories", args: {} }, thoughtSignature: SIG_B },
      ],
    });
    // Second round's model turn: contents[3]
    // Without this assertion, a mutation that only assigns tokens to round 1
    // would still pass.
    expect(contents[3]).toEqual({
      role: "model",
      parts: [
        { functionCall: { name: "get_monthly_summary", args: { month: "2026-09" } }, thoughtSignature: SIG_C },
        // No token of its own, and it must not borrow a neighbour's.
        { functionCall: { name: "list_categories", args: {} } },
        { functionCall: { name: "get_monthly_summary", args: { month: "2026-10" } }, thoughtSignature: SIG_D },
      ],
    });
  });

  // No test for "a call with no token sends no `thoughtSignature`": every way
  // of writing that passes. The body is captured after `JSON.stringify`, which
  // drops an `undefined` value, so omitting the key and assigning `undefined`
  // are the same bytes — a guard here could not fail, which is worse than none.
});

async function failureFrom(client: GeminiModelClient): Promise<ModelFailure> {
  try {
    await client.turn(KEY, "sys", [{ role: "user", content: "q" }], [A_TOOL], []);
  } catch (err) {
    if (err instanceof ModelFailure) return err;
    throw err;
  }
  throw new Error("expected the turn to fail");
}

describe("the three failures stay three", () => {
  // Three fixtures, each landing in a different bucket — two identical
  // fixtures could not prove the buckets are distinct. Each asserts its own
  // literal reason, so collapsing any two reddens at least one test.

// Every error fixture below embeds the key **inside the provider's own
// message** — the only place a leak could come from. The classifier never
// receives the key, so `not.toContain(KEY)` against a clean fixture is green
// whatever the code does: measured, leaking the whole response body into the
// failure passed all nine tests before these fixtures carried the canary.
  it("a rejected key: Gemini's infamous 400 INVALID_ARGUMENT + API_KEY_INVALID", async () => {
    const { client } = clientCapturing(
      json(400, {
        error: {
          code: 400,
          message: `API key not valid: ${KEY}`,
          status: "INVALID_ARGUMENT",
          details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }],
        },
      }),
    );

    const failure = await failureFrom(client);

    expect(failure.reason).toBe("key_rejected");
    expect(failure.message).not.toContain(KEY);
  });

  it("an exhausted quota: 429 RESOURCE_EXHAUSTED", async () => {
    const { client } = clientCapturing(
      json(429, {
        error: { code: 429, message: `You exceeded your current quota for key ${KEY}`, status: "RESOURCE_EXHAUSTED" },
      }),
    );

    const failure = await failureFrom(client);

    expect(failure.reason).toBe("quota_exhausted");
    expect(failure.message).not.toContain(KEY);
  });

  it("a model this key cannot use: 404 NOT_FOUND", async () => {
    const { client } = clientCapturing(
      json(404, {
        error: { code: 404, message: `models/gemini-2.5-flash is not found for API version v1beta (key ${KEY})`, status: "NOT_FOUND" },
      }),
    );

    const failure = await failureFrom(client);

    expect(failure.reason).toBe("model_unavailable");
    expect(failure.message).not.toContain(KEY);
  });

  it(
    "a 400 INVALID_ARGUMENT without API_KEY_INVALID — e.g. missing thought_signature — "
      + "is unknown, not mistaken for a key rejection",
    async () => {
      // A real example: missing thought_signature on a replayed tool call
      const { client } = clientCapturing(
        json(400, {
          error: {
            code: 400,
            message: "Invalid request: Request contains an invalid argument.",
            status: "INVALID_ARGUMENT",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "INVALID_REQUEST",
                domain: "googleapis.com",
              },
            ],
          },
        }),
      );

      const failure = await failureFrom(client);

      // The point of this test: must be `unknown`, not `key_rejected` — we
      // misclassifying this as a key error would send the user to re-enter a
      // valid key when the problem is our adapter not carrying tokens.
      expect(failure.reason).toBe("unknown");
      expect(failure.message).not.toContain(KEY);
    },
  );

  it("anything else — a 503 — is unknown, not misfiled into a caller-blaming bucket", async () => {
    const { client } = clientCapturing(json(503, { error: { code: 503, message: `overloaded while serving ${KEY}`, status: "UNAVAILABLE" } }));

    const failure = await failureFrom(client);

    expect(failure.reason).toBe("unknown");
    expect(failure.message).not.toContain(KEY);
  });

  it("a network error carries nothing from the request out, even when fetch's own message would", async () => {
    // A realistic worst case: the runtime error message embeds the URL and —
    // if the key were ever in the URL — the key.
    const client = new GeminiModelClient(async () => {
      throw new TypeError(`fetch failed: connect ETIMEDOUT https://example.invalid/?key=${KEY}`);
    });

    const failure = await failureFrom(client);

    expect(failure.reason).toBe("unknown");
    expect(failure.message).not.toContain(KEY);
  });

  it("an unparseable success body is unknown, with no body text in the error", async () => {
    const { client } = clientCapturing(new Response("<html>not json</html>", { status: 200 }));

    const failure = await failureFrom(client);

    expect(failure.reason).toBe("unknown");
    expect(failure.message).not.toContain("html");
  });
});
