import type { AssistantMessage, ModelClient, ToolResult, ToolRound } from "../domain/model-client";
import { assistantTools, runTool, type Proposal, type ToolContext } from "./tools";

/**
 * How many tool rounds one request may spend (parallel calls in one turn count
 * as one round). Real questions resolve in one or two; the cap exists for a
 * model that loops.
 */
const MAX_TOOL_ROUNDS = 4;

/**
 * Said out loud when the cap is hit — a fixed server-side sentence, not
 * something the model is trusted to mention. A silent truncation would read
 * as a complete answer that happens to be wrong.
 */
export const TOOL_LIMIT_NOTICE = "已達到工具呼叫上限，以上是目前查到的內容。";

/**
 * Nothing but the date and the assistant's bounds — no data is preloaded into
 * the context. Every fact the model uses has to come back through a tool,
 * which is what keeps one request from shipping a month of records to the
 * provider as a matter of course.
 *
 * The two states get different wording, and the out-of-scope sentence moves
 * with the visibility one: left naming finance alone, it would tell the model
 * to decline the very health questions this request just gave it tools for.
 *
 * This is an instruction the assistant carries, not a filter the server
 * applies — under BYOK the model runs at the provider and the server never
 * sees its output. What the server refuses to *fetch* is the enforceable half,
 * and that lives in `assistantTools` and `runTool`.
 */
function systemPrompt(context: ToolContext): string {
  return [
    `Today is ${context.today} and the caller's current month is ${context.defaultMonth}.`,
    context.health
      ? "You are a finance and health assistant. Through your tools you can see the caller's own finance, split, health and diet records, and nothing else."
      : "You are a finance assistant. Through your tools you can see the caller's own finance and split records, and nothing else.",
    context.health
      ? "You cannot see care or reminder records; if asked about those, say you cannot see them."
      : "You cannot see health, diet, care or reminder records; if asked about those, say you cannot see them.",
    context.health
      ? "Anything that is not about the caller's own finance, split, health or diet records, or about what this assistant can do, is out of scope: general knowledge, news, brands, products, recipes, medicine, code, and chit-chat."
      : "Anything that is not about the caller's own finance and split records, or about what this assistant can do, is out of scope: general knowledge, news, brands, products, recipes, medicine, code, and chit-chat.",
    "Decline every out-of-scope question in one short sentence in the caller's language and say what you can help with instead — do not answer it even when you know the answer.",
    "Recording a transaction only produces a proposal the caller must accept — never claim something was saved.",
  ].join(" ");
}

/**
 * The tool loop: ask the model, run what it asks for, feed the answers back,
 * until it answers in prose or the round cap is hit.
 *
 * A tool failure — unknown name, bad arguments — is a result the model reads
 * and recovers from, not an exception; the model is the caller here and it can
 * try again. Proposals are collected across rounds and returned to the user
 * untouched: nothing in this loop writes.
 */
export async function converse(
  model: ModelClient,
  apiKey: string,
  messages: AssistantMessage[],
  context: ToolContext,
): Promise<{ text: string; proposals: Proposal[] }> {
  const system = systemPrompt(context);
  const tools = assistantTools(context);
  const proposals: Proposal[] = [];
  const rounds: ToolRound[] = [];

  let turn = await model.turn(apiKey, system, messages, tools, rounds);

  while (turn.toolCalls.length > 0) {
    if (rounds.length >= MAX_TOOL_ROUNDS) {
      const text = turn.text.trim();
      return { text: text === "" ? TOOL_LIMIT_NOTICE : `${text}\n${TOOL_LIMIT_NOTICE}`, proposals };
    }

    const results: ToolResult[] = [];
    for (const call of turn.toolCalls) {
      const outcome = await runTool(context, call.name, call.arguments);
      if (outcome.proposal) proposals.push(outcome.proposal);
      results.push({ id: call.id, name: call.name, result: outcome.result });
    }
    rounds.push({ calls: turn.toolCalls, results });

    turn = await model.turn(apiKey, system, messages, tools, rounds);
  }

  return { text: turn.text, proposals };
}
