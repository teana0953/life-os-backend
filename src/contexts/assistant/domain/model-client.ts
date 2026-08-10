/** One turn of a conversation, as the client sends it and as the loop replays it. */
export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * A tool the model may call. Provider-neutral on purpose: the adapter
 * translates this into whatever shape its provider wants (Gemini's
 * `functionDeclarations`, Anthropic's `tools`, …). That boundary already
 * exists — it is the signature of "take messages and tools, return text or a
 * call" — so naming it costs nothing and a second provider is a new file.
 */
export interface AssistantTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Providers accept a subset; keep it flat. */
  parameters: Record<string, unknown>;
}

/** The model asked for a tool. `id` is echoed back with the result. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;

  /**
   * An opaque token the provider attached to this call and requires back,
   * verbatim, when the call is replayed on the next request. Never read or
   * interpreted here — captured, carried, handed back.
   *
   * Gemini 3 calls it `thought_signature` and rejects a replayed
   * `functionCall` that lacks one with `400 INVALID_ARGUMENT`, so a tool loop
   * that drops it cannot get past its first round. Provider-neutral in name
   * because the next adapter will have its own word for the same idea, and
   * `undefined` when a provider issues none.
   *
   * Lives only inside one `converse` call: rounds are built and spent within
   * a single request and never reach the client, so nothing has to store it.
   */
  providerToken?: string;
}

/** What a model turn produced: prose, tool calls, or both. */
export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
}

/**
 * Why a model request failed, as far as the caller needs to distinguish.
 *
 * All three are the caller's own account, and all three otherwise read as
 * "the assistant is broken" — which is both wrong and unactionable. They are
 * separate values precisely so no handler can collapse them by accident.
 */
export type ModelFailureReason = "key_rejected" | "quota_exhausted" | "model_unavailable" | "unknown";

export class ModelFailure extends Error {
  constructor(readonly reason: ModelFailureReason) {
    super(`model request failed: ${reason}`);
  }
}

/** Driven port: one round-trip to a model. */
export interface ModelClient {
  /**
   * @param apiKey the caller's own key — used for this request and kept
   *   nowhere. It is a parameter rather than constructor state so that no
   *   instance can outlive the request that supplied it.
   * @param system provider-neutral system instruction (Gemini has a dedicated
   *   `systemInstruction` field; other providers have equivalents).
   * @param rounds every completed tool round so far, oldest first. Grouped —
   *   not a flat result list — because a provider must replay the model's own
   *   `functionCall` turn before the matching `functionResponse` turn, and a
   *   flat list loses which calls belonged together.
   */
  turn(apiKey: string, system: string, messages: AssistantMessage[], tools: AssistantTool[], rounds: ToolRound[]): Promise<ModelTurn>;
}

/** The answer to one `ToolCall`, fed back on the next turn. */
export interface ToolResult {
  id: string;
  name: string;
  result: unknown;
}

/** One completed round of tool use: what the model asked for, and every answer. */
export interface ToolRound {
  calls: ToolCall[];
  results: ToolResult[];
}
