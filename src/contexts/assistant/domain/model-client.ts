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
   */
  turn(apiKey: string, messages: AssistantMessage[], tools: AssistantTool[], toolResults: ToolResult[]): Promise<ModelTurn>;
}

/** The answer to one `ToolCall`, fed back on the next turn. */
export interface ToolResult {
  id: string;
  name: string;
  result: unknown;
}
