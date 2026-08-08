import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOLS, runTool, type ToolContext } from "../../../src/contexts/assistant/application/tools";

/**
 * What the assistant can reach, and what it deliberately cannot.
 *
 * The list is asserted **whole**, not by absence: `expect(names).not.toContain("x")`
 * stays green for every tool added after it was written, which makes it a
 * guard that cannot fail for the thing it is guarding against.
 */
describe("the assistant's tool list", () => {
  it("is exactly these five, and no health, diet, care or reminder tool exists", () => {
    // A free provider tier generally reserves the right to train on what it
    // is sent, and this product holds menstrual, glucose and care records.
    expect(ASSISTANT_TOOLS.map((tool) => tool.name)).toEqual([
      "get_monthly_summary",
      "list_categories",
      "list_budgets",
      "get_split_balances",
      "propose_transaction",
    ]);
  });

  it("offers no way to write a split record", () => {
    // Split fields are visible to other participants, so a write there is a
    // channel for putting text on somebody else's screen. Covered by the
    // whole-list assertion above too; stated separately because it is a
    // decision, not an accident of ordering.
    const writesSplit = ASSISTANT_TOOLS.filter((tool) => /split/.test(tool.name) && /propose|create|update|delete/.test(tool.name));
    expect(writesSplit).toEqual([]);
  });
});

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

describe("running a tool", () => {
  it("asks the use case for the caller's own id, never one from the arguments", async () => {
    // The model produces the arguments, and the arguments come partly from
    // text other people wrote. An id taken from there is somebody else's
    // records.
    const seen: string[] = [];
    const context = contextWith({
      transactions: { getMonthlySummaryRaw: async (userId: string) => { seen.push(userId); return { totals: [], byCategory: [] }; } } as never,
    });

    await runTool(context, "get_monthly_summary", { user_id: "somebody-else", userId: "somebody-else" });

    expect(seen).toEqual(["user-1"]);
  });

  it("proposes a transaction and writes nothing", async () => {
    const context = contextWith();

    const outcome = await runTool(context, "propose_transaction", { type: "expense", amount: 180, category_name: "餐飲" });

    // Every repository in this context throws if touched, so "wrote nothing"
    // is proven by the call completing at all, not merely asserted.
    expect(outcome.proposal).toEqual({
      kind: "create_transaction",
      fields: { type: "expense", amount: 180, currency: null, category_name: "餐飲", day: "2026-08-08", note: null },
    });
    // The model is told as well, so it does not go on to say it saved.
    expect(outcome.result).toEqual({ proposed: true, saved: false });
  });

  it("answers an unknown tool instead of throwing", async () => {
    const outcome = await runTool(contextWith(), "delete_everything", {});

    expect(outcome.result).toEqual({ error: "unknown tool: delete_everything" });
    expect(outcome.proposal).toBeUndefined();
  });

  it("falls back to the caller's month when the model gives a malformed one", async () => {
    const seen: string[] = [];
    const context = contextWith({
      transactions: { getMonthlySummaryRaw: async (_u: string, month: string) => { seen.push(month); return { totals: [], byCategory: [] }; } } as never,
    });

    await runTool(context, "get_monthly_summary", { month: "last month" });
    await runTool(context, "get_monthly_summary", { month: "2026-03" });

    expect(seen).toEqual(["2026-08", "2026-03"]);
  });
});
