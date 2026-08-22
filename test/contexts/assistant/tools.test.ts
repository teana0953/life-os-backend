import { describe, expect, it } from "vitest";
import { assistantTools, runTool, type HealthPorts, type ToolContext } from "../../../src/contexts/assistant/application/tools";
import { getMenstrualOverview } from "../../../src/contexts/health/application/get-menstrual-overview";
import type { MenstrualPeriod } from "../../../src/contexts/health/domain/menstrual-period";

const unusable = new Proxy({}, { get: () => () => { throw new Error("this repository must not be reached"); } });

function healthPorts(overrides: Partial<HealthPorts> = {}): HealthPorts {
  return {
    dailyTargets: unusable as never,
    meals: unusable as never,
    water: unusable as never,
    bowel: unusable as never,
    vitals: unusable as never,
    exercise: unusable as never,
    menstrual: unusable as never,
    bodyProfile: unusable as never,
    ...overrides,
  };
}

/**
 * What the assistant can reach, and what it deliberately cannot.
 *
 * The list is asserted **whole**, not by absence: `expect(names).not.toContain("x")`
 * stays green for every tool added after it was written, which makes it a
 * guard that cannot fail for the thing it is guarding against. Both states get
 * their own whole-list assertion for the same reason: "the health tools are in
 * the open list" would stay green with a health tool leaking into the closed
 * one.
 */
describe("the assistant's tool list", () => {
  it("is exactly these six without the health opt-in, and no health, diet, care or reminder tool exists", () => {
    // A free provider tier generally reserves the right to train on what it
    // is sent, and this product holds menstrual, glucose and care records.
    expect(assistantTools(contextWith()).map((tool) => tool.name)).toEqual([
      "get_monthly_summary",
      "list_transactions",
      "list_categories",
      "list_budgets",
      "get_split_balances",
      "propose_transaction",
    ]);
  });

  it("is exactly these fifteen with the health opt-in, and still no care or reminder tool", () => {
    expect(assistantTools(contextWith({ health: healthPorts() })).map((tool) => tool.name)).toEqual([
      "get_monthly_summary",
      "list_transactions",
      "list_categories",
      "list_budgets",
      "get_split_balances",
      "propose_transaction",
      "get_diet_targets",
      "list_meals",
      "get_water_day",
      "get_bowel_day",
      "get_exercise_day",
      "get_vitals_day",
      "get_vitals_range",
      "get_weight_goal",
      "get_menstrual_overview",
    ]);
  });

  it("offers no way to write a split record", () => {
    // Split fields are visible to other participants, so a write there is a
    // channel for putting text on somebody else's screen. Covered by the
    // whole-list assertion above too; stated separately because it is a
    // decision, not an accident of ordering.
    const writesSplit = assistantTools(contextWith()).filter((tool) => /split/.test(tool.name) && /propose|create|update|delete/.test(tool.name));
    expect(writesSplit).toEqual([]);
  });

  it("tells the model about the two server bounds, so a clamped answer is not presented as complete", () => {
    const tools = assistantTools(contextWith({ health: healthPorts() }));
    const describedBy = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";

    expect(describedBy("get_vitals_range")).toContain("at most 31 days");
    expect(describedBy("get_menstrual_overview")).toContain("12 most recent cycles");
  });
});

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

const HEALTH_TOOL_NAMES = [
  "get_diet_targets",
  "list_meals",
  "get_water_day",
  "get_bowel_day",
  "get_exercise_day",
  "get_vitals_day",
  "get_vitals_range",
  "get_weight_goal",
  "get_menstrual_overview",
];

describe("running a health tool without the opt-in", () => {
  it("answers every one of the nine exactly as an unknown name, reaching no repository", async () => {
    // The advertised list and what the server will execute are two surfaces.
    // A model naming a health tool from an earlier turn — or from text
    // somebody else wrote — must be refused by the code that runs tools, not
    // only by its absence from the list. `contextWith()` has no `health`
    // field at all, so there is nothing here to read a health record with.
    const answers = await Promise.all(
      HEALTH_TOOL_NAMES.map(async (name) => [name, (await runTool(contextWith(), name, {})).result]),
    );

    expect(answers).toEqual(HEALTH_TOOL_NAMES.map((name) => [name, { error: `unknown tool: ${name}` }]));
  });

  it("gives a health tool the same answer as a name that does not exist at all", async () => {
    // A distinct "not permitted" message would tell the model — and anything
    // reading the transcript — that a tool by that name exists and is being
    // withheld, which is a fact about the caller.
    const withheld = await runTool(contextWith(), "get_vitals_day", {});
    const nonexistent = await runTool(contextWith(), "get_vitals_day_that_never_existed", {});

    expect(withheld.result).toEqual({ error: "unknown tool: get_vitals_day" });
    expect(JSON.stringify(withheld.result).replace("get_vitals_day", "X")).toBe(
      JSON.stringify(nonexistent.result).replace("get_vitals_day_that_never_existed", "X"),
    );
  });
});

describe("running a health tool with the opt-in", () => {
  /**
   * Each entry wires exactly the ports its use case reads and records the
   * `(userId, day)` pair the use case was given. The other seven ports stay
   * throw-on-touch, so "one question fetches one record type" is proven by
   * the call completing rather than merely asserted.
   */
  const dayScoped: Array<{ name: string; ports: (seen: Array<[string, string]>) => Partial<HealthPorts> }> = [
    {
      name: "get_diet_targets",
      ports: (seen) => ({
        dailyTargets: { get: async (u: string, d: string) => { seen.push([u, d]); return null; }, getLatestOnOrBefore: async () => null } as never,
        meals: { listMealsByDay: async () => [] } as never,
      }),
    },
    {
      name: "list_meals",
      ports: (seen) => ({ meals: { listMealsByDay: async (u: string, d: string) => { seen.push([u, d]); return []; } } as never }),
    },
    {
      name: "get_water_day",
      ports: (seen) => ({
        water: {
          getTarget: async (u: string, d: string) => { seen.push([u, d]); return null; },
          getLatestTargetOnOrBefore: async () => null,
          getIntake: async () => null,
        } as never,
      }),
    },
    {
      name: "get_bowel_day",
      ports: (seen) => ({ bowel: { get: async (u: string, d: string) => { seen.push([u, d]); return null; } } as never }),
    },
    {
      name: "get_exercise_day",
      ports: (seen) => ({ exercise: { listByDay: async (u: string, d: string) => { seen.push([u, d]); return []; } } as never }),
    },
    {
      name: "get_vitals_day",
      ports: (seen) => ({ vitals: { get: async (u: string, d: string) => { seen.push([u, d]); return null; } } as never }),
    },
  ];

  for (const { name, ports } of dayScoped) {
    it(`${name} runs under the caller's own id, and a missing, malformed, or calendar-invalid day means the caller's today`, async () => {
      // The day never comes from `new Date()` here — it is `context.today`,
      // which the route resolved from the caller's timezone. A test that
      // computed the expected day itself would pass under UTC+8 and fail
      // under CI's UTC.
      const seen: Array<[string, string]> = [];
      const context = contextWith({ health: healthPorts(ports(seen)) });

      await runTool(context, name, { user_id: "somebody-else", userId: "somebody-else" });
      await runTool(context, name, { day: "2026-07-01" });
      await runTool(context, name, { day: "yesterday" });
      // Shape-valid, calendar-invalid: February has no 31st. Every health
      // `day` lands in a Postgres `date` comparison, so a regex-only check
      // would forward this straight into a driver error instead of falling
      // back to today.
      await runTool(context, name, { day: "2026-02-31" });

      expect(seen).toEqual([
        ["user-1", "2026-08-08"],
        ["user-1", "2026-07-01"],
        ["user-1", "2026-08-08"],
        ["user-1", "2026-08-08"],
      ]);
    });
  }

  it("get_weight_goal reaches both of its ports under the caller's own id", async () => {
    const seen: string[] = [];
    const context = contextWith({
      health: healthPorts({
        bodyProfile: { get: async (u: string) => { seen.push(`profile:${u}`); return null; } } as never,
        vitals: {
          getLatestWeight: async (u: string) => { seen.push(`latest:${u}`); return null; },
          getEarliestWeight: async (u: string) => { seen.push(`earliest:${u}`); return null; },
          getWeightDayCount: async (u: string) => { seen.push(`count:${u}`); return 0; },
        } as never,
      }),
    });

    await runTool(context, "get_weight_goal", { userId: "somebody-else" });

    expect(seen).toEqual(["profile:user-1", "latest:user-1", "earliest:user-1", "count:user-1"]);
  });

  it("runs get_vitals_range under the caller's own id, never one from the arguments", async () => {
    // The two tools that take no `day` — a full vitals range and an entire
    // menstrual history — are the biggest disclosures in this design; a
    // model-supplied userId here is a cross-account read, not a fixture edge
    // case.
    const seen: string[] = [];
    const context = contextWith({ health: healthPorts({ vitals: { listRange: async (u: string) => { seen.push(u); return []; } } as never }) });

    await runTool(context, "get_vitals_range", { userId: "somebody-else", user_id: "somebody-else" });

    expect(seen).toEqual(["user-1"]);
  });

  it("honours the model's `to`, not always the caller's today", async () => {
    // Every other vitals-range test's `to` equals `context.today`, which
    // cannot distinguish "reads the model's `to`" from "always uses today".
    const seen: Array<[string, string]> = [];
    const context = contextWith({ health: healthPorts({ vitals: { listRange: async (_u: string, f: string, t: string) => { seen.push([f, t]); return []; } } as never }) });

    await runTool(context, "get_vitals_range", { from: "2026-05-15", to: "2026-06-01" });

    expect(seen).toEqual([["2026-05-15", "2026-06-01"]]);
  });

  it("falls back a calendar-invalid `from` to the clamp's own earliest, not the value verbatim", async () => {
    // Independent of the `to` check: `from` also feeds straight into a
    // Postgres `date` comparison, so a shape-only regex here reddens the
    // same way `to` does, just through the other argument.
    const seen: Array<[string, string]> = [];
    const context = contextWith({ health: healthPorts({ vitals: { listRange: async (_u: string, f: string, t: string) => { seen.push([f, t]); return []; } } as never }) });

    // "2026-08-32" (August has 31 days) sorts *after* the clamp's earliest
    // lexically, unlike "2026-02-31" — so it is not saved by the `<` clamp
    // comparison catching it as "too early"; only a real calendar check
    // rejects it.
    await runTool(context, "get_vitals_range", { from: "2026-08-32", to: "2026-08-08" });

    expect(seen).toEqual([["2026-07-09", "2026-08-08"]]);
  });

  it("falls back a calendar-invalid `to` to the caller's today", async () => {
    // Shape-valid, calendar-invalid `to` values feed `addDays` before the
    // clamp; letting one through can overflow the clamp math itself, not
    // just crash the query.
    const seen: Array<[string, string]> = [];
    const context = contextWith({ health: healthPorts({ vitals: { listRange: async (_u: string, f: string, t: string) => { seen.push([f, t]); return []; } } as never }) });

    await runTool(context, "get_vitals_range", { to: "9999-99-99" });

    expect(seen).toEqual([["2026-07-09", "2026-08-08"]]);
  });

  it("passes a vitals range within the server's span through untouched", async () => {
    // 2026-07-09..2026-08-08 is exactly 31 days: the widest span that must
    // survive unclamped. Its neighbour one day wider is the next test — the
    // pair straddles the boundary, so an off-by-one in either direction
    // reddens one of them.
    const seen: Array<[string, string, string]> = [];
    const context = contextWith({ health: healthPorts({ vitals: { listRange: async (u: string, f: string, t: string) => { seen.push([u, f, t]); return []; } } as never }) });

    await runTool(context, "get_vitals_range", { from: "2026-07-09", to: "2026-08-08" });

    expect(seen).toEqual([["user-1", "2026-07-09", "2026-08-08"]]);
  });

  it("clamps a vitals range wider than the server allows instead of refusing it", async () => {
    const seen: Array<[string, string, string]> = [];
    const context = contextWith({ health: healthPorts({ vitals: { listRange: async (u: string, f: string, t: string) => { seen.push([u, f, t]); return []; } } as never }) });

    const justOver = await runTool(context, "get_vitals_range", { from: "2026-07-08", to: "2026-08-08" });
    await runTool(context, "get_vitals_range", { from: "2025-08-08", to: "2026-08-08" });

    // `from` moves forward to `to - 30 days`; the caller gets an answer, not
    // an error (spec: "answered with the bounded result rather than refused").
    expect(seen).toEqual([
      ["user-1", "2026-07-09", "2026-08-08"],
      ["user-1", "2026-07-09", "2026-08-08"],
    ]);
    // The answer reports the range actually read, so the model cannot present
    // a clamped month as the year it asked for.
    expect(justOver.result).toMatchObject({ from: "2026-07-09", to: "2026-08-08" });
  });

  it("defaults a vitals range to the 31 days ending on the caller's today", async () => {
    const seen: Array<[string, string, string]> = [];
    const context = contextWith({ health: healthPorts({ vitals: { listRange: async (u: string, f: string, t: string) => { seen.push([u, f, t]); return []; } } as never }) });

    await runTool(context, "get_vitals_range", {});

    expect(seen).toEqual([["user-1", "2026-07-09", "2026-08-08"]]);
  });

  it("runs get_menstrual_overview under the caller's own id, never one from the arguments", async () => {
    const seen: string[] = [];
    const context = contextWith({ health: healthPorts({ menstrual: { listByUser: async (u: string) => { seen.push(u); return []; } } as never }) });

    await runTool(context, "get_menstrual_overview", { userId: "somebody-else", user_id: "somebody-else" });

    expect(seen).toEqual(["user-1"]);
  });

  it("returns only the most recent twelve cycles, with the statistics still computed over the whole history", async () => {
    // 14 recorded cycles: two more than the cap, so a missing clamp returns
    // 14 and fails here. The two oldest are deliberately 10 days long against
    // the newer ones' 4, so `averagePeriodDays` (a mean over *every* period)
    // differs between the full history and the clamped tail — recomputing the
    // statistics from the 12 returned cycles reddens this too.
    const starts = [
      "2025-06-01", "2025-07-01", "2025-08-01", "2025-09-01", "2025-10-01", "2025-11-01", "2025-12-01",
      "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01",
    ];
    const periods: MenstrualPeriod[] = starts.map((startDate, i) => ({
      id: `p-${i}`,
      userId: "user-1",
      startDate,
      endDate: `${startDate.slice(0, 8)}${i < 2 ? "10" : "04"}`,
    }));
    const menstrual = { listByUser: async () => periods } as never;
    const context = contextWith({ health: healthPorts({ menstrual }) });

    const outcome = await runTool(context, "get_menstrual_overview", {});
    const wholeHistory = await getMenstrualOverview(menstrual, "user-1");

    const result = outcome.result as { periods: MenstrualPeriod[]; stats: unknown; lastPeriod: MenstrualPeriod | null };
    expect(result.periods.map((p) => p.id)).toEqual(periods.slice(2).map((p) => p.id));
    expect(result.stats).toEqual(wholeHistory.stats);
    expect(wholeHistory.stats.averagePeriodDays).toBe(5);
    expect(result.lastPeriod).toEqual(periods[periods.length - 1]);
  });
});
