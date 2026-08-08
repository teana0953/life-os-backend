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
