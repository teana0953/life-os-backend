import { describe, expect, it } from "vitest";
import { converse, TOOL_LIMIT_NOTICE } from "../../../src/contexts/assistant/application/converse";
import type { ToolContext } from "../../../src/contexts/assistant/application/tools";
import type { AssistantMessage, ModelClient, ModelTurn, ToolRound } from "../../../src/contexts/assistant/domain/model-client";

/**
 * Every repository throws if touched. The loop must not preload any data into
 * the model's context (task 5.2) — the only way to a record is a tool the
 * model explicitly called, and tests that need one override that repository.
 */
function contextWith(overrides: Partial<ToolContext> = {}): ToolContext {
  const unusable = new Proxy({}, { get: () => () => { throw new Error("this repository must not be reached"); } });
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

  constructor(private readonly script: (call: number) => ModelTurn) {}

  async turn(_apiKey: string, system: string, _messages: AssistantMessage[], _tools: unknown, rounds: ToolRound[]): Promise<ModelTurn> {
    this.calls += 1;
    // The fuse: with the loop's cap deleted, this test must go red fast, not
    // hang — a hung test run has no red letters (測試卡死≠通過).
    if (this.calls > 6) throw new Error("fuse blown: the loop no longer has a cap");
    this.seenSystem.push(system);
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
});
