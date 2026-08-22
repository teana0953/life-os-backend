import { describe, expect, it } from "vitest";
import { converse, TOOL_LIMIT_NOTICE } from "../../../src/contexts/assistant/application/converse";
import { assistantTools, type HealthPorts, type ToolContext } from "../../../src/contexts/assistant/application/tools";
import type { AssistantMessage, AssistantTool, ModelClient, ModelTurn, ToolRound } from "../../../src/contexts/assistant/domain/model-client";

/**
 * Every repository throws if touched. The loop must not preload any data into
 * the model's context (task 5.2) — the only way to a record is a tool the
 * model explicitly called, and tests that need one override that repository.
 */
const unusable = new Proxy({}, { get: () => () => { throw new Error("this repository must not be reached"); } });

/** Opted in, and every port still throws if touched — the prompt branch does not read a record. */
const healthPorts: HealthPorts = {
  dailyTargets: unusable as never,
  meals: unusable as never,
  water: unusable as never,
  bowel: unusable as never,
  vitals: unusable as never,
  exercise: unusable as never,
  menstrual: unusable as never,
  bodyProfile: unusable as never,
};

function contextWith(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "user-1",
    today: "2026-08-08",
    defaultMonth: "2026-08",
    transactions: unusable as never,
    categories: unusable as never,
    budgets: unusable as never,
    balances: unusable as never,
    ...overrides,
  };
}

const ASK = [{ role: "user", content: "hi" }] as AssistantMessage[];

/** Plays back scripted turns, records everything it was given, and blows a fuse rather than looping forever. */
class ScriptedModel implements ModelClient {
  calls = 0;
  seenSystem: string[] = [];
  seenRounds: ToolRound[][] = [];
  seenTools: AssistantTool[][] = [];

  constructor(private readonly script: (call: number) => ModelTurn) {}

  async turn(_apiKey: string, system: string, _messages: AssistantMessage[], tools: AssistantTool[], rounds: ToolRound[]): Promise<ModelTurn> {
    this.calls += 1;
    // The fuse: with the loop's cap deleted, this test must go red fast, not
    // hang — a hung test run has no red letters (測試卡死≠通過).
    if (this.calls > 6) throw new Error("fuse blown: the loop no longer has a cap");
    this.seenSystem.push(system);
    this.seenTools.push(tools);
    // Snapshot: the loop mutates its rounds array in place between turns.
    this.seenRounds.push(rounds.map((r) => ({ calls: [...r.calls], results: [...r.results] })));
    return this.script(this.calls);
  }
}

describe("the tool loop", () => {
  it("stops at the round cap and says so in a fixed sentence, instead of truncating silently", async () => {
    // The model never stops asking for tools.
    const model = new ScriptedModel(() => ({
      text: "",
      toolCalls: [{ id: "c", name: "get_monthly_summary", arguments: {} }],
    }));
    const context = contextWith({
      transactions: { getMonthlySummaryRaw: async () => ({ totals: [], byCategory: [] }) } as never,
    });

    const result = await converse(model, "key", ASK, context);

    // 1 initial turn + 4 tool rounds. Written as a literal, not imported from
    // the loop: a cap raised by accident has to disagree with something.
    expect(model.calls).toBe(5);
    expect(result.text).toContain(TOOL_LIMIT_NOTICE);
  });

  it("keeps the model's partial prose when the cap cuts in", async () => {
    const model = new ScriptedModel(() => ({
      text: "查到一半",
      toolCalls: [{ id: "c", name: "get_monthly_summary", arguments: {} }],
    }));
    const context = contextWith({
      transactions: { getMonthlySummaryRaw: async () => ({ totals: [], byCategory: [] }) } as never,
    });

    const result = await converse(model, "key", ASK, context);

    expect(result.text).toContain("查到一半");
    expect(result.text).toContain(TOOL_LIMIT_NOTICE);
  });

  it("answers an unknown tool back to the model instead of throwing", async () => {
    const model = new ScriptedModel((call) =>
      call === 1
        ? { text: "", toolCalls: [{ id: "x", name: "drop_table", arguments: {} }] }
        : { text: "done", toolCalls: [] },
    );

    const result = await converse(model, "key", ASK, contextWith());

    expect(result.text).toBe("done");
    // The second turn saw the first round's result, and it was an error the
    // model can read — not a 500 the caller sees.
    expect(model.seenRounds[1]).toEqual([
      {
        calls: [{ id: "x", name: "drop_table", arguments: {} }],
        results: [{ id: "x", name: "drop_table", result: { error: "unknown tool: drop_table" } }],
      },
    ]);
  });

  it("answers bad tool arguments back to the model, and issues no proposal for them", async () => {
    const model = new ScriptedModel((call) =>
      call === 1
        ? { text: "", toolCalls: [{ id: "p", name: "propose_transaction", arguments: { type: "expense" } }] }
        : { text: "amount?", toolCalls: [] },
    );

    const result = await converse(model, "key", ASK, contextWith());

    expect(result.proposals).toEqual([]);
    expect(model.seenRounds[1][0].results[0].result).toEqual({ error: "amount must be a number" });
  });

  it("carries proposals out of the loop, and completes with every repository unusable", async () => {
    const model = new ScriptedModel((call) =>
      call === 1
        ? { text: "", toolCalls: [{ id: "p", name: "propose_transaction", arguments: { type: "expense", amount: 180, category_name: "餐飲" } }] }
        : { text: "提議好了", toolCalls: [] },
    );

    // Every repository throws if touched, so this completing at all is the
    // proof that proposing wrote nothing — not an assertion of absence.
    const result = await converse(model, "key", ASK, contextWith());

    expect(result.proposals).toEqual([
      {
        kind: "create_transaction",
        fields: { type: "expense", amount: 180, currency: null, category_name: "餐飲", day: "2026-08-08", note: null },
      },
    ]);
    expect(result.text).toBe("提議好了");
  });

  it("preloads nothing: a plain answer touches no repository", async () => {
    const model = new ScriptedModel(() => ({ text: "你好", toolCalls: [] }));

    // contextWith() has only throw-on-touch repositories. If the loop stuffed
    // transactions (or anything else) into the context up front, this throws.
    const result = await converse(model, "key", ASK, contextWith());

    expect(result).toEqual({ text: "你好", proposals: [] });
  });

  it("tells the model the caller's date and that health records are out of reach", async () => {
    const model = new ScriptedModel(() => ({ text: "ok", toolCalls: [] }));

    await converse(model, "key", ASK, contextWith());

    // The spec's health-question scenario rests on this sentence plus the
    // tool list; deleting either half of the prompt goes red here.
    expect(model.seenSystem[0]).toContain("2026-08-08");
    expect(model.seenSystem[0]).toContain("health");
  });

  it("tells the model to decline questions that are not about the caller's records", async () => {
    const model = new ScriptedModel(() => ({ text: "ok", toolCalls: [] }));

    await converse(model, "key", ASK, contextWith());

    // The prompt is the only lever here: with BYOK the provider runs the
    // model, so nothing server-side can stop an off-topic answer. This guards
    // the instruction's presence, not the model's obedience — it goes red if
    // the out-of-scope rule is dropped from the prompt, and it cannot prove
    // any given question is refused.
    const system = model.seenSystem[0];
    expect(system).toContain("out of scope");
    expect(system).toContain("general knowledge");
    expect(system).toContain("Decline");
  });

  it("carries the provider's opaque per-call token into the round it replays", async () => {
    // The loop pushes `turn.toolCalls` into the round as-is, so the token
    // survives by object identity alone — nothing here says it must. A
    // refactor that rebuilds the calls (`.map(c => ({id, name, arguments}))`,
    // the obvious tidy-up) drops it silently, and the adapter then replays a
    // `functionCall` with no `thoughtSignature`: Gemini answers 400
    // INVALID_ARGUMENT and every tool loop dies on its second round. That is
    // the exact outage the adapter change exists to fix, reintroduced one
    // layer up where the adapter's own tests cannot see it.
    const model = new ScriptedModel((call) =>
      call === 1
        ? {
            text: "",
            toolCalls: [
              {
                id: "c",
                name: "get_monthly_summary",
                arguments: {},
                providerToken: "opaque-token-from-the-provider",
              },
            ],
          }
        : { text: "done", toolCalls: [] },
    );
    const context = contextWith({
      transactions: { getMonthlySummaryRaw: async () => ({ totals: [], byCategory: [] }) } as never,
    });

    await converse(model, "key", ASK, context);

    // The second turn is the one that replays round 1.
    expect(model.seenRounds[1][0].calls[0].providerToken).toBe("opaque-token-from-the-provider");
  });
});

/**
 * The instructions the model is given, asserted whole in each state.
 *
 * These guard that the instruction is **present**, and nothing more. Under
 * BYOK the model runs on the provider's side and the server never sees its
 * output, so no test here — and no code on this side — can prove the model
 * obeyed. A green test below must not be read as "health leakage is blocked":
 * the enforceable half of that lives in `runTool`'s refusal and in which tools
 * the list carries, both covered in tools.test.ts.
 */
describe("the instructions the model is given", () => {
  const HEALTH_OFF_PROMPT = [
    "Today is 2026-08-08 and the caller's current month is 2026-08.",
    "You are a finance assistant. Through your tools you can see the caller's own finance and split records, and nothing else.",
    "You cannot see health, diet, care or reminder records; if asked about those, say you cannot see them.",
    "Anything that is not about the caller's own finance and split records, or about what this assistant can do, is out of scope: general knowledge, news, brands, products, recipes, medicine, code, and chit-chat.",
    "Decline every out-of-scope question in one short sentence in the caller's language and say what you can help with instead — do not answer it even when you know the answer.",
    "Recording a transaction only produces a proposal the caller must accept — never claim something was saved.",
  ].join(" ");

  const HEALTH_ON_PROMPT = [
    "Today is 2026-08-08 and the caller's current month is 2026-08.",
    "You are a finance and health assistant. Through your tools you can see the caller's own finance, split, health and diet records, and nothing else.",
    "You cannot see care or reminder records; if asked about those, say you cannot see them.",
    "Anything that is not about the caller's own finance, split, health or diet records, or about what this assistant can do, is out of scope: general knowledge, news, brands, products, recipes, medicine, code, and chit-chat.",
    "Decline every out-of-scope question in one short sentence in the caller's language and say what you can help with instead — do not answer it even when you know the answer.",
    "Recording a transaction only produces a proposal the caller must accept — never claim something was saved.",
  ].join(" ");

  it("says health records are out of reach when the caller has not opted in (an instruction, not a server-side block)", async () => {
    const model = new ScriptedModel(() => ({ text: "ok", toolCalls: [] }));

    await converse(model, "key", ASK, contextWith());

    expect(model.seenSystem[0]).toBe(HEALTH_OFF_PROMPT);
  });

  it("says health and diet are visible and care and reminders are not when the caller has opted in (an instruction, not a server-side block)", async () => {
    // The out-of-scope sentence widens in the same breath as the visibility
    // one: left naming finance alone it would tell the model to decline the
    // very health questions it was just given tools for.
    const model = new ScriptedModel(() => ({ text: "ok", toolCalls: [] }));

    await converse(model, "key", ASK, contextWith({ health: healthPorts }));

    expect(model.seenSystem[0]).toBe(HEALTH_ON_PROMPT);
  });
});

describe("the tool list the model is offered", () => {
  it("carries the health tools only when the caller has opted in", async () => {
    const off = new ScriptedModel(() => ({ text: "ok", toolCalls: [] }));
    const on = new ScriptedModel(() => ({ text: "ok", toolCalls: [] }));

    await converse(off, "key", ASK, contextWith());
    await converse(on, "key", ASK, contextWith({ health: healthPorts }));

    expect(off.seenTools[0].map((tool) => tool.name)).toEqual(assistantTools(contextWith()).map((tool) => tool.name));
    expect(on.seenTools[0].map((tool) => tool.name)).toEqual(
      assistantTools(contextWith({ health: healthPorts })).map((tool) => tool.name),
    );
    expect(on.seenTools[0].length - off.seenTools[0].length).toBe(9);
  });
});
