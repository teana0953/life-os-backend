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
  it("is exactly these six, and no health, diet, care or reminder tool exists", () => {
    // A free provider tier generally reserves the right to train on what it
    // is sent, and this product holds menstrual, glucose and care records.
    expect(ASSISTANT_TOOLS.map((tool) => tool.name)).toEqual([
      "get_monthly_summary",
      "list_transactions",
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

  it("caps a transaction listing at the server's maximum, not the number the model asked for", async () => {
    // 51 rows in the month: one more than the cap, so a listing that honours
    // the model's 500 — or drops the clamp — returns 51 and fails here. A
    // fixture at or under 50 could not tell those apart.
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `txn-${i}`,
      userId: "user-1",
      type: "expense",
      amount: 100 + i,
      currency: "TWD",
      categoryId: "cat-1",
      date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
      note: null,
      splitExpenseId: null,
      categorySource: "manual",
    }));
    const context = contextWith({
      transactions: { listByUserAndRange: async () => rows } as never,
    });

    const outcome = await runTool(context, "list_transactions", { limit: 500 });

    expect((outcome.result as unknown[]).length).toBe(50);
  });

  it("maps every field from the repository row, not a neighbour's value or a dropped key", async () => {
    // Every field below has its own distinct value. A fixture with two fields
    // sharing a value (or null) would still pass if the mapping read the
    // wrong key or silently dropped one — this fixture cannot.
    const row = {
      id: "txn-1",
      userId: "user-1",
      type: "income",
      amount: 12345,
      currency: "USD",
      categoryId: "cat-77",
      date: "2026-08-15",
      note: "a distinct note",
      splitExpenseId: null,
      categorySource: "manual",
    };
    const context = contextWith({
      transactions: { listByUserAndRange: async () => [row] } as never,
    });

    const outcome = await runTool(context, "list_transactions", {});

    // category_id must come from categoryId (snake_case translation, not a
    // same-named passthrough) — swapping in any other field's value, or
    // dropping a key, reddens this.
    expect(outcome.result).toEqual([
      { id: "txn-1", date: "2026-08-15", type: "income", amount: 12345, currency: "USD", category_id: "cat-77", note: "a distinct note" },
    ]);
  });

  it("still returns at least one row for a limit of zero or below, instead of an empty page", async () => {
    // The clamp floors the model's limit at 1 (spec: "lands in 1..MAX"). A
    // fixture with only one row and a non-positive limit reddens if that
    // floor is ever dropped — Math.min(0, MAX) alone would return [].
    const row = {
      id: "txn-1",
      userId: "user-1",
      type: "expense",
      amount: 1,
      currency: "TWD",
      categoryId: "c",
      date: "2026-08-01",
      note: null,
      splitExpenseId: null,
      categorySource: "manual",
    };
    const context = contextWith({
      transactions: { listByUserAndRange: async () => [row] } as never,
    });

    const zero = await runTool(context, "list_transactions", { limit: 0 });
    const negative = await runTool(context, "list_transactions", { limit: -5 });

    expect((zero.result as unknown[]).length).toBe(1);
    expect((negative.result as unknown[]).length).toBe(1);
  });

  it("returns the default page when the model names no limit", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `txn-${i}`,
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: "cat-1",
      date: "2026-08-05",
      note: null,
      splitExpenseId: null,
      categorySource: "manual",
    }));
    const context = contextWith({
      transactions: { listByUserAndRange: async () => rows } as never,
    });

    const outcome = await runTool(context, "list_transactions", {});

    expect((outcome.result as unknown[]).length).toBe(20);
  });

  it("asks for the whole month's range, newest first", async () => {
    const seen: Array<[string, string]> = [];
    const context = contextWith({
      transactions: {
        listByUserAndRange: async (_u: string, from: string, to: string) => {
          seen.push([from, to]);
          return [
            { id: "old", userId: "user-1", type: "expense", amount: 1, currency: "TWD", categoryId: "c", date: "2026-08-01", note: null, splitExpenseId: null, categorySource: "manual" },
            { id: "new", userId: "user-1", type: "expense", amount: 2, currency: "TWD", categoryId: "c", date: "2026-08-20", note: null, splitExpenseId: null, categorySource: "manual" },
          ];
        },
      } as never,
    });

    const outcome = await runTool(context, "list_transactions", {});

    // August has 31 days; a hardcoded "-30" or an off-by-one month arithmetic
    // bug shows up here.
    expect(seen).toEqual([["2026-08-01", "2026-08-31"]]);
    expect((outcome.result as Array<{ id: string }>).map((t) => t.id)).toEqual(["new", "old"]);
  });

  it("answers a proposal without a numeric amount with an error, not a card", async () => {
    // A proposal with an undefined amount would render as a blank the user
    // might accept; the model is told to try again instead.
    const outcome = await runTool(contextWith(), "propose_transaction", { type: "expense" });

    expect(outcome.result).toEqual({ error: "amount must be a number" });
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
