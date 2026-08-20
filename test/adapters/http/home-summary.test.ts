import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  argsOf,
  BUDGET_AMOUNT,
  BUDGET_SPENT,
  buildBatchApp,
  CARRIED_DAILY_TARGET,
  HEIGHT_CM,
  initBatchAuth,
  neverSettles,
  rejectsWith,
  TREND_WEIGHT_KG,
  validToken,
} from "./batch-stubs";

const DAY = "2026-08-20";

const SECTION_KEYS = ["weight_goal", "vitals_trend", "menstrual", "budgets", "net_worth", "split_balances", "daily_target"] as const;

type SectionBody = Record<string, { ok: boolean; data?: unknown; error?: string }>;

beforeAll(initBatchAuth);

type BatchApp = ReturnType<typeof buildBatchApp>["app"];

async function get(app: BatchApp, path: string, token: string) {
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } });
}

describe("GET /api/home-summary", () => {
  it("returns all seven sections as ok envelopes, each with its own payload", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const res = await get(app, `/api/home-summary?day=${DAY}`, token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionBody;
    expect(Object.keys(body).sort()).toEqual([...SECTION_KEYS].sort());
    for (const key of SECTION_KEYS) {
      expect(body[key], key).toEqual({ ok: true, data: expect.anything() });
    }
    expect(body.weight_goal.data).toMatchObject({ height_cm: HEIGHT_CM, current_weight_kg: TREND_WEIGHT_KG });
    expect(body.vitals_trend.data).toMatchObject({ from: "2025-08-20", to: DAY });
    expect(body.menstrual.data).toMatchObject({ periods: [expect.objectContaining({ start_date: "2026-07-20" })] });
    expect(body.budgets.data).toEqual({
      month: "2026-08",
      budgets: [{ id: "budget-1", category_id: null, amount: BUDGET_AMOUNT, spent: BUDGET_SPENT, remaining: BUDGET_AMOUNT - BUDGET_SPENT, percent: 25 }],
    });
    expect(body.net_worth.data).toMatchObject({ month: "2026-08", net_worth: 30_000, total_asset: 50_000, total_liability: 20_000 });
    expect(body.split_balances.data).toEqual({
      balances: [{ user_id: "user-2", display_name: "Bob", balances: [{ currency: "TWD", amount: 250 }] }],
    });
    expect(body.daily_target.data).toMatchObject({
      day: DAY,
      base: { staple: CARRIED_DAILY_TARGET.baseStaple, meat: CARRIED_DAILY_TARGET.baseMeat, fruit: CARRIED_DAILY_TARGET.baseFruit, veg: CARRIED_DAILY_TARGET.baseVeg },
    });
  });

  it("derives the month for budgets and net worth from day", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/home-summary?day=${DAY}`, token);

    expect(argsOf(calls, "financeBudget.listWithSpent").slice(1)).toEqual(["2026-08"]);
    expect(argsOf(calls, "financeNetWorth.listMonthValues").slice(1)).toEqual(["2026-08"]);
  });

  // The home tile shows the most recent BP sample, so its default lookback is a
  // year — deliberately not the health screen's 30 days (design.md D4).
  it("defaults the trend window to the 366 days ending at day", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/home-summary?day=${DAY}`, token);

    expect(argsOf(calls, "vitals.listRange").slice(1)).toEqual(["2025-08-20", DAY]);
  });

  it("honours an explicit trend_days", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/home-summary?day=${DAY}&trend_days=30`, token);

    expect(argsOf(calls, "vitals.listRange").slice(1)).toEqual(["2026-07-22", DAY]);
  });

  it("passes day itself to the day-scoped section", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/home-summary?day=${DAY}`, token);

    expect(argsOf(calls, "dailyTarget.get").slice(1)).toEqual([DAY]);
  });

  it("resolves the user id once for the whole request", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/home-summary?day=${DAY}`, token);

    expect(calls.filter((call) => call.name === "user.getOrCreate")).toHaveLength(1);
  });
});

describe("GET /api/home-summary request-level faults", () => {
  it("rejects a missing day with 400 and no section object", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const res = await get(app, "/api/home-summary", token);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("bad_request");
    for (const key of SECTION_KEYS) expect(body[key]).toBeUndefined();
  });

  it("rejects a malformed day and an out-of-range window with 400", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    expect((await get(app, "/api/home-summary?day=20-08-2026", token)).status).toBe(400);
    expect((await get(app, `/api/home-summary?day=${DAY}&trend_days=400`, token)).status).toBe(400);
    expect((await get(app, `/api/home-summary?day=${DAY}&trend_days=0`, token)).status).toBe(400);
  });

  it("rejects a missing bearer token with 401 and no section object", async () => {
    const { app } = buildBatchApp();

    const res = await app.request(`/api/home-summary?day=${DAY}`);

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of SECTION_KEYS) expect(body[key]).toBeUndefined();
  });
});

describe("GET /api/home-summary per-section isolation", () => {
  it("keeps every other section when the net-worth query really rejects", async () => {
    const { app } = buildBatchApp({ "financeNetWorth.listMonthValues": rejectsWith("networth query exploded") });
    const token = await validToken();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(app, `/api/home-summary?day=${DAY}`, token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionBody;
    expect(body.net_worth).toEqual({ ok: false, error: "unavailable" });
    expect(body.budgets.data).toMatchObject({ month: "2026-08" });
    expect(body.weight_goal.data).toMatchObject({ height_cm: HEIGHT_CM });
    expect(body.split_balances.data).toMatchObject({ balances: [expect.objectContaining({ display_name: "Bob" })] });
    expect(body.daily_target.data).toMatchObject({ day: DAY });
    vi.restoreAllMocks();
  });

  it("returns 200 with all seven sections unavailable when every query throws", async () => {
    const boom = rejectsWith("everything is down");
    const { app } = buildBatchApp({
      "bodyProfile.get": boom,
      "vitals.listRange": boom,
      "menstrual.listByUser": boom,
      "financeBudget.listWithSpent": boom,
      "financeNetWorth.listMonthValues": boom,
      "splitBalance.balancesForUser": boom,
      "dailyTarget.get": boom,
    });
    const token = await validToken();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(app, `/api/home-summary?day=${DAY}`, token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionBody;
    for (const key of SECTION_KEYS) {
      expect(body[key], key).toEqual({ ok: false, error: "unavailable" });
    }
    vi.restoreAllMocks();
  });

  it("leaks none of the failure's text into the response body", async () => {
    const secret = "postgres://life:hunter2@ep-internal.neon.tech:5432/db";
    const { app } = buildBatchApp({ "financeBudget.listWithSpent": rejectsWith(secret) });
    const token = await validToken();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const text = await (await get(app, `/api/home-summary?day=${DAY}`, token)).text();

    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("ep-internal.neon.tech");
    expect(text).toContain('"budgets":{"ok":false,"error":"unavailable"}');
    vi.restoreAllMocks();
  });

  it("reports a never-settling section as unavailable and returns the rest", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = buildBatchApp({ "splitBalance.balancesForUser": neverSettles() });
    const token = await validToken();

    const pending = get(app, `/api/home-summary?day=${DAY}`, token);
    await vi.advanceTimersByTimeAsync(8_000);
    const res = await pending;

    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionBody;
    expect(body.split_balances).toEqual({ ok: false, error: "unavailable" });
    for (const key of SECTION_KEYS) expect(body[key], key).toBeDefined();
    expect(body.budgets.data).toMatchObject({ month: "2026-08" });
    expect(body.weight_goal.data).toMatchObject({ height_cm: HEIGHT_CM });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("GET /api/home-summary payload equality with the granular endpoints", () => {
  it("matches the granular budgets, net worth, balances, weight goal, menstrual and daily target", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const batch = (await (await get(app, `/api/home-summary?day=${DAY}`, token)).json()) as SectionBody;

    expect(batch.budgets.data).toEqual(await (await get(app, "/api/finance/budgets?month=2026-08", token)).json());
    expect(batch.net_worth.data).toEqual(await (await get(app, "/api/finance/networth?month=2026-08", token)).json());
    expect(batch.split_balances.data).toEqual(await (await get(app, "/api/split/balances", token)).json());
    expect(batch.weight_goal.data).toEqual(await (await get(app, "/api/weight-goal", token)).json());
    expect(batch.menstrual.data).toEqual(await (await get(app, "/api/menstrual", token)).json());
    expect(batch.daily_target.data).toEqual(await (await get(app, `/api/daily-target?day=${DAY}`, token)).json());
    expect(batch.vitals_trend.data).toEqual(await (await get(app, `/api/vitals/range?from=2025-08-20&to=${DAY}`, token)).json());
  });
});

describe("GET /api/home-summary query budget (Workers subrequest ceiling)", () => {
  /**
   * Same ceiling as the health endpoint: 50 subrequests per request on the
   * Free plan (docs read 2026-08-20) — see health-overview.test.ts's
   * counterpart comment for why "repository calls" and "subrequests" are not
   * the same unit in general, only for repositories issuing one query per call.
   */
  it("issues 16 repository reads in the worst case", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/home-summary?day=${DAY}`, token);

    expect(calls.length).toBe(16);
    expect(calls.length).toBeLessThan(50);
  });
});
