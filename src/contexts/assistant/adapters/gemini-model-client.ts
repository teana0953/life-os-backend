import {
  ModelFailure,
  type AssistantMessage,
  type AssistantTool,
  type ModelClient,
  type ModelTurn,
  type ToolCall,
  type ToolRound,
} from "../domain/model-client";

/**
 * One model, not configurable: the free-tier workhorse. A second model — or a
 * second provider — is a new adapter, not a parameter.
 *
 * Was `gemini-2.5-flash` until Google closed it to new accounts —
 * `404 NOT_FOUND "no longer available to new users"`, which meant every key
 * created after that date could not use the assistant at all while existing
 * keys kept working. Pinned to a version rather than the `gemini-flash-latest`
 * alias: an alias moves the model under us and this adapter's whole contract
 * (tool calling, the token below) is model-behaviour.
 */
const GEMINI_MODEL = "gemini-3.6-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * What Gemini wants on a replayed `functionCall` that never carried a
 * signature of its own. Not a placeholder we invented — the provider's own
 * documented opt-out for exactly this case.
 *
 * It is needed because Gemini signs only the **first** `functionCall` part of
 * a parallel-call turn; the rest arrive legitimately unsigned, and there is
 * nothing for a client to echo back. Omitting the field instead is rejected.
 * Both halves verified against the live API on 2026-08-10 with the identical
 * body otherwise: field omitted → `400 INVALID_ARGUMENT "Function call is
 * missing a thought_signature"`; this string → `200`.
 */
const NO_SIGNATURE = "skip_thought_signature_validator";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Gemini requires `functionResponse.response` to be an object; wrap anything else. */
function asObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { result: value };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Maps a non-2xx Gemini response to one of the caller-distinguishable
 * failures. The thrown error carries the reason and nothing else — never the
 * response body, never the request, never the key.
 *
 * - A bad key comes back as HTTP **400** `INVALID_ARGUMENT` with an
 *   `API_KEY_INVALID` detail (not 401 — a known Gemini quirk); a 403
 *   `PERMISSION_DENIED` blaming the API key is the same story.
 * - Quota is HTTP 429 `RESOURCE_EXHAUSTED`.
 * - A model this key cannot use is HTTP 404 `NOT_FOUND`.
 */
function classifyFailure(status: number, body: unknown): ModelFailure {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const errorStatus = typeof error.status === "string" ? error.status : "";
  const message = typeof error.message === "string" ? error.message : "";
  const reasons = (Array.isArray(error.details) ? error.details : [])
    .map((d) => (isRecord(d) && typeof d.reason === "string" ? d.reason : ""));

  if (status === 400 && errorStatus === "INVALID_ARGUMENT" && reasons.includes("API_KEY_INVALID")) {
    return new ModelFailure("key_rejected");
  }
  if (status === 403 && errorStatus === "PERMISSION_DENIED" && /api key/i.test(message)) {
    return new ModelFailure("key_rejected");
  }
  if (status === 429 || errorStatus === "RESOURCE_EXHAUSTED") {
    return new ModelFailure("quota_exhausted");
  }
  if (status === 404 || errorStatus === "NOT_FOUND") {
    return new ModelFailure("model_unavailable");
  }
  return new ModelFailure("unknown");
}

interface GeminiPart {
  text?: string;
  functionCall?: { name?: unknown; args?: unknown };
  /** Gemini 3's opaque per-part token — see `ToolCall.providerToken`. */
  thoughtSignature?: unknown;
}

/**
 * `ModelClient` over Gemini's `generateContent` REST API.
 *
 * The key travels in the `x-goog-api-key` **header** — never the URL, even
 * though the provider's own examples use `?key=`: query strings reach access
 * logs, `Referer` headers and browser history.
 */
export class GeminiModelClient implements ModelClient {
  constructor(
    // Bound to globalThis because Workers' fetch throws "illegal invocation"
    // if invoked with a non-global `this` (same precedent as HttpChaodaysClient).
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async turn(
    apiKey: string,
    system: string,
    messages: AssistantMessage[],
    tools: AssistantTool[],
    rounds: ToolRound[],
  ): Promise<ModelTurn> {
    const contents: Array<{ role: "user" | "model"; parts: unknown[] }> = messages.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));
    for (const round of rounds) {
      // Gemini insists on seeing the model's own functionCall turn before the
      // matching functionResponse turn, with parallel calls grouped — which is
      // exactly why the port keeps rounds together instead of a flat list.
      contents.push({
        role: "model",
        // The token goes back verbatim on its own call's part, and a call
        // that never had one goes back with [NO_SIGNATURE] — *not* with the
        // field left off, which Gemini rejects (400 INVALID_ARGUMENT) and
        // which would end every parallel-call tool loop on round two, since
        // only the first call of such a turn is signed at all.
        parts: round.calls.map((call) => ({
          functionCall: { name: call.name, args: call.arguments },
          thoughtSignature: call.providerToken ?? NO_SIGNATURE,
        })),
      });
      contents.push({
        role: "user",
        parts: round.results.map((result) => ({ functionResponse: { name: result.name, response: asObject(result.result) } })),
      });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}/${GEMINI_MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          tools: [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) }],
        }),
      });
    } catch {
      // The cause is dropped on purpose: a network error's message can embed
      // the request URL, and nothing from the request may leave this method.
      throw new ModelFailure("unknown");
    }

    if (!response.ok) {
      throw classifyFailure(response.status, await safeJson(response));
    }

    const payload = await safeJson(response);
    const candidates = isRecord(payload) && Array.isArray(payload.candidates) ? payload.candidates : [];
    const first: unknown = candidates[0];
    const content = isRecord(first) && isRecord(first.content) ? first.content : null;
    const parts = content !== null && Array.isArray(content.parts) ? (content.parts as GeminiPart[]) : null;
    if (parts === null) throw new ModelFailure("unknown");

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if (typeof part.text === "string") text += part.text;
      const call = isRecord(part.functionCall) ? part.functionCall : null;
      if (call && typeof call.name === "string") {
        // Gemini's functionCall carries no id; mint one for the neutral
        // layer's call/result pairing. It is never sent back to Gemini —
        // replay matches by name and order.
        toolCalls.push({
          id: `${call.name}#${toolCalls.length}`,
          name: call.name,
          arguments: isRecord(call.args) ? call.args : {},
          // The token rides on the same part as the call it belongs to, so it
          // is read here and nowhere else — pairing them later, by name or by
          // order, is exactly the mistake that loses it.
          ...(typeof part.thoughtSignature === "string" ? { providerToken: part.thoughtSignature } : {}),
        });
      }
    }
    return { text, toolCalls };
  }
}
