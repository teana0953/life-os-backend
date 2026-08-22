import { describe, expect, it } from "vitest";
import { assistantTools, runTool, type HealthPorts, type ToolContext } from "../../../src/contexts/assistant/application/tools";
import { getMenstrualOverview } from "../../../src/contexts/health/application/get-menstrual-overview";
import type { FoodItem } from "../../../src/contexts/health/domain/food-item";
import type { MealEntry, MealItem } from "../../../src/contexts/health/domain/meal-entry";
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
    foodDictionary: unusable as never,
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

  it("is exactly these eighteen with the health opt-in, and still no care or reminder tool", () => {
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
      "list_favorite_foods",
      "list_recent_foods",
      "search_foods",
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

  it("tells the model about every server bound, so a clamped answer is not presented as complete", () => {
    const tools = assistantTools(contextWith({ health: healthPorts() }));
    const describedBy = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";

    expect(describedBy("get_vitals_range")).toContain("at most 31 days");
    expect(describedBy("get_menstrual_overview")).toContain("12 most recent cycles");
    expect(describedBy("list_recent_foods")).toContain("at most 30 days");
    expect(describedBy("list_recent_foods")).toContain("at most 30 foods");
    expect(describedBy("search_foods")).toContain("at most 20 rows");
    // Not a bound, but the reason the model should reach here first: the list
    // is the caller's own, so it needs no clamp and no search.
    expect(describedBy("list_favorite_foods")).toContain("favourite");
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
  "list_favorite_foods",
  "list_recent_foods",
  "search_foods",
];

describe("running a health tool without the opt-in", () => {
  it("answers every one of the twelve exactly as an unknown name, reaching no repository", async () => {
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


/**
 * The fields a food candidate carries, and the fields it does not.
 *
 * Every field kept here is a field sent to a provider that may train on what
 * it receives, so the keys are asserted **whole** rather than by
 * `not.toHaveProperty`: a field added to the projection later cannot slip
 * through green.
 */
const CANDIDATE_KEYS = ["name", "staple", "meat", "fruit", "veg", "kcal", "base_amount", "measure_unit"];

function foodItem(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: "food-1",
    ownerUserId: "user-1",
    name: "糙米飯",
    carbG: 40,
    proteinG: 4,
    fatG: 1,
    sugarG: 0.5,
    fiberG: 2,
    kcal: 190,
    staple: 1,
    meat: 0,
    fruit: 0,
    veg: 0,
    baseAmount: 100,
    measureUnit: "g",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function mealItem(overrides: Partial<MealItem> = {}): MealItem {
  return {
    id: "item-1",
    mealEntryId: "meal-1",
    foodItemId: "food-1",
    name: "糙米飯",
    photoRef: null,
    source: "dict",
    unclassified: false,
    carbG: 40,
    proteinG: 4,
    fatG: 1,
    sugarG: 0.5,
    fiberG: 2,
    kcal: 190,
    staple: 1,
    meat: 0,
    fruit: 0,
    veg: 0,
    quantity: 2,
    baseAmount: 100,
    measureUnit: "g",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function mealEntry(day: string, items: MealItem[]): MealEntry {
  return { id: `meal-${day}-${items[0]?.name ?? ""}`, userId: "user-1", day, meal: "lunch", time: new Date(`${day}T12:00:00Z`), createdAt: new Date(`${day}T12:00:00Z`), items };
}

/** A context whose three food sources answer with `items`/`meals` and record nothing else. */
function foodContext(overrides: { favorites?: FoodItem[]; search?: FoodItem[]; meals?: MealEntry[] }): ToolContext {
  return contextWith({
    health: healthPorts({
      foodDictionary: {
        listFavorites: async () => overrides.favorites ?? [],
        search: async () => overrides.search ?? [],
      } as never,
      meals: { listMealsInRange: async () => overrides.meals ?? [] } as never,
    }),
  });
}

describe("the food candidate projection", () => {
  it("carries the name, the per-unit portions, the calories and the measure basis — and nothing else — from all three sources", async () => {
    const item = foodItem({ name: "地瓜", staple: 1.5, meat: 0.25, fruit: 0.5, veg: 0.75, kcal: 123, baseAmount: 60, measureUnit: "顆" });
    const context = foodContext({
      favorites: [item],
      search: [item],
      meals: [mealEntry("2026-08-08", [mealItem({ name: "地瓜", staple: 1.5, meat: 0.25, fruit: 0.5, veg: 0.75, kcal: 123, baseAmount: 60, measureUnit: "顆" })])],
    });

    const favorites = (await runTool(context, "list_favorite_foods", {})).result as Record<string, unknown>[];
    const search = (await runTool(context, "search_foods", { query: "地" })).result as Record<string, unknown>[];
    const recent = (await runTool(context, "list_recent_foods", {})).result as Record<string, unknown>[];

    const projected = { name: "地瓜", staple: 1.5, meat: 0.25, fruit: 0.5, veg: 0.75, kcal: 123, base_amount: 60, measure_unit: "顆" };
    expect(favorites).toEqual([projected]);
    expect(search).toEqual([projected]);
    // Recent foods carry the two extra fields that make one candidate a
    // different suggestion from another, and nothing beyond them.
    expect(recent).toEqual([{ ...projected, times_eaten: 1, last_eaten_day: "2026-08-08" }]);

    expect(Object.keys(favorites[0])).toEqual(CANDIDATE_KEYS);
    expect(Object.keys(search[0])).toEqual(CANDIDATE_KEYS);
    expect(Object.keys(recent[0])).toEqual([...CANDIDATE_KEYS, "times_eaten", "last_eaten_day"]);
  });

  it("withholds the identifier, the owner, the macronutrients and the timestamps from all three sources", async () => {
    // The fixture carries every withheld field with a value the assertion can
    // name, so adding any one of them back into any of the three projections
    // reddens this.
    const context = foodContext({
      favorites: [foodItem()],
      search: [foodItem()],
      meals: [mealEntry("2026-08-08", [mealItem()])],
    });

    const rows = [
      ...((await runTool(context, "list_favorite_foods", {})).result as Record<string, unknown>[]),
      ...((await runTool(context, "search_foods", { query: "糙" })).result as Record<string, unknown>[]),
      ...((await runTool(context, "list_recent_foods", {})).result as Record<string, unknown>[]),
    ];

    expect(rows.length).toBe(3);
    for (const row of rows) {
      for (const withheld of ["id", "ownerUserId", "owner_user_id", "carbG", "proteinG", "fatG", "sugarG", "fiberG", "createdAt", "foodItemId", "quantity"]) {
        expect(Object.keys(row)).not.toContain(withheld);
      }
    }
  });
});

describe("list_favorite_foods", () => {
  it("asks for the caller's own favourites, never an id from the arguments", async () => {
    const seen: string[] = [];
    const context = contextWith({
      health: healthPorts({ foodDictionary: { listFavorites: async (u: string) => { seen.push(u); return []; } } as never }),
    });

    await runTool(context, "list_favorite_foods", { userId: "somebody-else", user_id: "somebody-else" });

    expect(seen).toEqual(["user-1"]);
  });

  it("returns every favourite, unclamped — the list's size is the caller's own choice, not the model's", async () => {
    // 31 favourites: one more than the recent-foods cap, so a clamp copied
    // over from there reddens here. Dropping a favourite would make the
    // assistant's answer wrong in a way neither the caller nor the model can
    // see.
    const favorites = Array.from({ length: 31 }, (_, i) => foodItem({ id: `food-${i}`, name: `fav-${i}` }));
    const context = foodContext({ favorites });

    const outcome = await runTool(context, "list_favorite_foods", {});

    expect((outcome.result as unknown[]).length).toBe(31);
  });
});

describe("list_recent_foods", () => {
  /** Records the range the port was asked for; the answer is empty. */
  function rangeContext(seen: Array<[string, string, string]>): ToolContext {
    return contextWith({
      health: healthPorts({
        meals: { listMealsInRange: async (u: string, from: string, to: string) => { seen.push([u, from, to]); return []; } } as never,
      }),
    });
  }

  it("looks back the server's default window, ending on the caller's today, under the caller's own id", async () => {
    // The window is inclusive, so 30 days back from 2026-08-08 starts on
    // 2026-07-10 — an off-by-one shows up here rather than as a silently
    // wider read.
    const seen: Array<[string, string, string]> = [];

    await runTool(rangeContext(seen), "list_recent_foods", { userId: "somebody-else" });

    expect(seen).toEqual([["user-1", "2026-07-10", "2026-08-08"]]);
  });

  it("honours a window narrower than the server's maximum", async () => {
    const seen: Array<[string, string, string]> = [];

    await runTool(rangeContext(seen), "list_recent_foods", { days: 7 });

    expect(seen).toEqual([["user-1", "2026-08-02", "2026-08-08"]]);
  });

  it("clamps a window wider than the server allows instead of refusing it", async () => {
    // The pair straddles the boundary: 30 must pass through untouched and 31
    // must come back as 30, so an off-by-one in either direction reddens one
    // of the two.
    const seen: Array<[string, string, string]> = [];
    const context = rangeContext(seen);

    await runTool(context, "list_recent_foods", { days: 30 });
    await runTool(context, "list_recent_foods", { days: 31 });
    await runTool(context, "list_recent_foods", { days: 365 });

    expect(seen).toEqual([
      ["user-1", "2026-07-10", "2026-08-08"],
      ["user-1", "2026-07-10", "2026-08-08"],
      ["user-1", "2026-07-10", "2026-08-08"],
    ]);
  });

  it("floors a zero, negative or nonsense window at a single day", async () => {
    const seen: Array<[string, string, string]> = [];
    const context = rangeContext(seen);

    await runTool(context, "list_recent_foods", { days: 1 });
    await runTool(context, "list_recent_foods", { days: 0 });
    await runTool(context, "list_recent_foods", { days: -5 });

    expect(seen).toEqual([
      ["user-1", "2026-08-08", "2026-08-08"],
      ["user-1", "2026-08-08", "2026-08-08"],
      ["user-1", "2026-08-08", "2026-08-08"],
    ]);
  });

  it("falls back to the default window when `days` is not a finite number", async () => {
    const seen: Array<[string, string, string]> = [];
    const context = rangeContext(seen);

    await runTool(context, "list_recent_foods", { days: "a month" });
    await runTool(context, "list_recent_foods", { days: Number.NaN });

    expect(seen).toEqual([
      ["user-1", "2026-07-10", "2026-08-08"],
      ["user-1", "2026-07-10", "2026-08-08"],
    ]);
  });

  it("drops a nameless item and an unclassified item, keeping the one that is a usable candidate", async () => {
    // The three items sit on the two different sides of each distinction: a
    // candidate the model cannot name is not a candidate, and an unclassified
    // item carries zero portions by design, so offering it is offering a food
    // that fills nothing. Removing either filter reddens this.
    const context = foodContext({
      meals: [
        mealEntry("2026-08-08", [
          mealItem({ id: "a", name: null, source: "ai_photo" }),
          mealItem({ id: "b", name: "   " }),
          mealItem({ id: "c", name: "布丁", unclassified: true, staple: 0, meat: 0, fruit: 0, veg: 0 }),
          mealItem({ id: "d", name: "雞胸肉", staple: 0, meat: 2, kcal: 165 }),
        ]),
      ],
    });

    const outcome = await runTool(context, "list_recent_foods", {});

    expect((outcome.result as Array<{ name: string }>).map((f) => f.name)).toEqual(["雞胸肉"]);
  });

  it("returns one row per distinct name, with how many times it was eaten and the latest of those days", async () => {
    const context = foodContext({
      meals: [
        mealEntry("2026-07-15", [mealItem({ id: "1", name: "白飯" })]),
        mealEntry("2026-08-01", [mealItem({ id: "2", name: " 白飯 " })]),
        mealEntry("2026-07-20", [mealItem({ id: "3", name: "白飯" })]),
      ],
    });

    const outcome = await runTool(context, "list_recent_foods", {});

    // The days are deliberately out of order in the fixture and unevenly
    // spaced: the latest is neither the first nor the last row the port
    // returned, so "the earliest" and "whatever came back last" both redden.
    expect(outcome.result).toEqual([
      { name: "白飯", staple: 1, meat: 0, fruit: 0, veg: 0, kcal: 190, base_amount: 100, measure_unit: "g", times_eaten: 3, last_eaten_day: "2026-08-01" },
    ]);
  });

  it("groups two spellings that differ only in case as one food", async () => {
    // The dedup key is the trimmed *lowercased* name (design.md decision 3).
    // Every other fixture here is Chinese, which has no case at all, so
    // without this pair a key that dropped `toLowerCase()` would ship green.
    const context = foodContext({
      meals: [
        mealEntry("2026-07-15", [mealItem({ id: "1", name: "Latte" })]),
        mealEntry("2026-08-01", [mealItem({ id: "2", name: "latte" })]),
      ],
    });

    const outcome = await runTool(context, "list_recent_foods", {});

    expect(outcome.result).toEqual([
      { name: "latte", staple: 1, meat: 0, fruit: 0, veg: 0, kcal: 190, base_amount: 100, measure_unit: "g", times_eaten: 2, last_eaten_day: "2026-08-01" },
    ]);
  });

  it("takes the per-unit values from the most recent occurrence, never an average of the two", async () => {
    // Per-unit values are a snapshot taken at log time and may differ between
    // two days; an average would produce a food whose values never existed.
    const context = foodContext({
      meals: [
        mealEntry("2026-08-05", [mealItem({ id: "new", name: "地瓜", staple: 3, kcal: 300, baseAmount: 200, measureUnit: "顆" })]),
        mealEntry("2026-07-20", [mealItem({ id: "old", name: "地瓜", staple: 1, kcal: 100, baseAmount: 60, measureUnit: "g" })]),
      ],
    });

    const outcome = await runTool(context, "list_recent_foods", {});

    expect(outcome.result).toEqual([
      { name: "地瓜", staple: 3, meat: 0, fruit: 0, veg: 0, kcal: 300, base_amount: 200, measure_unit: "顆", times_eaten: 2, last_eaten_day: "2026-08-05" },
    ]);
  });

  it("returns at most the server's maximum distinct foods, keeping the most relevant candidates and cutting deterministically", async () => {
    // 31 distinct foods: one more than the cap. "常吃" was eaten three times
    // on the *oldest* day, so a sort that ignores the count drops it; the two
    // foods tying on both count and day sit at the cut, with the alphabetically
    // later one listed first in the fixture, so a missing name tie-break keeps
    // the wrong one of the pair.
    const singles = Array.from({ length: 28 }, (_, i) => {
      const day = `2026-08-${String(i + 1).padStart(2, "0")}`;
      return mealEntry(day, [mealItem({ id: `s-${i}`, name: `single-${day}` })]);
    });
    const context = foodContext({
      meals: [
        mealEntry("2026-07-10", [
          mealItem({ id: "z", name: "zzz-oldest" }),
          mealItem({ id: "a", name: "aaa-oldest" }),
          mealItem({ id: "o1", name: "常吃" }),
          mealItem({ id: "o2", name: "常吃" }),
          mealItem({ id: "o3", name: "常吃" }),
        ]),
        ...singles,
      ],
    });

    const names = ((await runTool(context, "list_recent_foods", {})).result as Array<{ name: string }>).map((f) => f.name);

    expect(names.length).toBe(30);
    expect(names[0]).toBe("常吃");
    expect(names[1]).toBe("single-2026-08-28");
    expect(names[29]).toBe("aaa-oldest");
    expect(names).not.toContain("zzz-oldest");
  });
});

describe("search_foods", () => {
  it("searches under the caller's own id with the model's query, never an id from the arguments", async () => {
    const seen: Array<[string, string]> = [];
    const context = contextWith({
      health: healthPorts({ foodDictionary: { search: async (u: string, q: string) => { seen.push([u, q]); return []; } } as never }),
    });

    await runTool(context, "search_foods", { query: "雞", userId: "somebody-else", user_id: "somebody-else" });

    expect(seen).toEqual([["user-1", "雞"]]);
  });

  it("returns at most the server's maximum rows, not the whole catalogue a one-character substring matches", async () => {
    // 21 rows: one more than the cap, so a missing slice returns 21 and fails
    // here. A fixture at or under 20 could not tell those apart.
    const context = foodContext({ search: Array.from({ length: 21 }, (_, i) => foodItem({ id: `f-${i}`, name: `hit-${i}` })) });

    const outcome = await runTool(context, "search_foods", { query: "h" });

    expect((outcome.result as unknown[]).length).toBe(20);
  });

  it("answers a missing, non-string or blank query with an error the model can read and retry from, not the whole catalogue", async () => {
    // Following `propose_transaction`: a bad argument is an answer, not a
    // throw and not a dump. The port throws on touch here, so "the search was
    // not run" is proven by the call completing at all.
    const context = contextWith({ health: healthPorts() });

    const absent = await runTool(context, "search_foods", {});
    const nonString = await runTool(context, "search_foods", { query: 42 });
    const empty = await runTool(context, "search_foods", { query: "" });
    const blank = await runTool(context, "search_foods", { query: "   " });

    for (const outcome of [absent, nonString, empty, blank]) {
      expect(outcome.result).toEqual({ error: "query must be a non-empty string" });
      expect(outcome.proposal).toBeUndefined();
    }
  });
});

describe("the food tools write nothing", () => {
  it("produces no proposal from any of the three, because they offer no write of any kind", async () => {
    const context = foodContext({ favorites: [foodItem()], search: [foodItem()], meals: [mealEntry("2026-08-08", [mealItem()])] });

    const outcomes = await Promise.all([
      runTool(context, "list_favorite_foods", {}),
      runTool(context, "list_recent_foods", {}),
      runTool(context, "search_foods", { query: "糙" }),
    ]);

    expect(outcomes.map((outcome) => outcome.proposal)).toEqual([undefined, undefined, undefined]);
  });
});
