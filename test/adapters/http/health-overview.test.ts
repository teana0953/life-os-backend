import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  argsOf,
  buildBatchApp,
  CARRIED_DAILY_TARGET,
  FAVORITE_FOOD_ITEM,
  HEIGHT_CM,
  initBatchAuth,
  LOGGED_CALENDAR_DAY,
  neverSettles,
  rejectsWith,
  TARGET_WEIGHT_KG,
  TREND_WEIGHT_KG,
  validToken,
  WATER_TARGET_ML,
  WATER_TOTAL_ML,
} from "./batch-stubs";

const DAY = "2026-08-20";

/**
 * Asserted by name, never by count: a renamed or dropped section has to fail
 * this list rather than slip through a `length` check.
 */
const SECTION_KEYS = [
  "weight_goal",
  "vitals_trend",
  "health_calendar",
  "meals",
  "daily_target",
  "favorite_food_items",
  "water",
  "bowel",
  "vitals",
  "exercise_activities",
  "exercise",
  "menstrual",
  "care_today",
  "care_range",
] as const;

type SectionBody = Record<string, { ok: boolean; data?: unknown; error?: string }>;

beforeAll(initBatchAuth);

type BatchApp = ReturnType<typeof buildBatchApp>["app"];

async function get(app: BatchApp, path: string, token: string) {
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } });
}

describe("GET /api/health-overview", () => {
  it("returns all fourteen sections as ok envelopes", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const res = await get(app, `/api/health-overview?day=${DAY}`, token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionBody;
    for (const key of SECTION_KEYS) {
      expect(body[key], key).toEqual({ ok: true, data: expect.anything() });
    }
    expect(Object.keys(body).sort()).toEqual([...SECTION_KEYS].sort());
  });

  it("carries each section's own payload, not a placeholder", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const body = (await (await get(app, `/api/health-overview?day=${DAY}`, token)).json()) as SectionBody;

    expect(body.weight_goal.data).toMatchObject({
      height_cm: HEIGHT_CM,
      target_weight_kg: TARGET_WEIGHT_KG,
      current_weight_kg: TREND_WEIGHT_KG,
    });
    expect(body.vitals_trend.data).toMatchObject({ from: "2026-07-22", to: DAY });
    expect(body.health_calendar.data).toMatchObject({ year: 2026, month: 8, logged_days: [LOGGED_CALENDAR_DAY] });
    expect(body.meals.data).toMatchObject({ day: DAY, meals: [] });
    expect(body.daily_target.data).toMatchObject({
      day: DAY,
      base: { staple: CARRIED_DAILY_TARGET.baseStaple, meat: CARRIED_DAILY_TARGET.baseMeat, fruit: CARRIED_DAILY_TARGET.baseFruit, veg: CARRIED_DAILY_TARGET.baseVeg },
    });
    expect(body.favorite_food_items.data).toEqual([expect.objectContaining({ id: FAVORITE_FOOD_ITEM.id, name: FAVORITE_FOOD_ITEM.name })]);
    expect(body.water.data).toEqual({ day: DAY, total_ml: WATER_TOTAL_ML, target_ml: WATER_TARGET_ML, remaining_ml: WATER_TARGET_ML - WATER_TOTAL_ML });
    expect(body.bowel.data).toEqual({ day: DAY, count: 2, is_normal: true, note: "ok" });
    expect(body.vitals.data).toMatchObject({ day: DAY, weight_kg: TREND_WEIGHT_KG });
    expect(body.exercise_activities.data).toMatchObject({ activities: expect.any(Array) });
    expect((body.exercise_activities.data as { activities: unknown[] }).activities.length).toBeGreaterThan(0);
    expect(body.exercise.data).toEqual({ day: DAY, entries: [], total_minutes: 0 });
    expect(body.menstrual.data).toMatchObject({ periods: [expect.objectContaining({ start_date: "2026-07-20" })] });
    expect(body.care_today.data).toMatchObject({ items: [] });
    expect(body.care_range.data).toMatchObject({ from: "2026-07-22", to: DAY });
  });

  it("defaults both windows to the 30 days ending at day, inclusive", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/health-overview?day=${DAY}`, token);

    expect(argsOf(calls, "vitals.listRange").slice(1)).toEqual(["2026-07-22", DAY]);
    expect(argsOf(calls, "careLog.listByUserAndDateRange").slice(1)).toEqual(["2026-07-22", DAY]);
  });

  it("honours explicit trend_days and care_days independently", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/health-overview?day=${DAY}&trend_days=7&care_days=90`, token);

    expect(argsOf(calls, "vitals.listRange").slice(1)).toEqual(["2026-08-14", DAY]);
    expect(argsOf(calls, "careLog.listByUserAndDateRange").slice(1)).toEqual(["2026-05-23", DAY]);
  });

  it("passes the day's month and the day itself to the calendar, and day to the day-scoped sections", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/health-overview?day=${DAY}`, token);

    // The calendar reads the whole month; `today` bounds "days elapsed" and is
    // the caller's day, never the server's UTC day.
    expect(argsOf(calls, "healthCalendar.listLoggedDays").slice(1)).toEqual(["2026-08-01", "2026-08-31"]);
    expect(argsOf(calls, "dailyTarget.listInRange").slice(1)).toEqual(["2026-08-01", "2026-08-20"]);
    expect(argsOf(calls, "bowel.get").slice(1)).toEqual([DAY]);
    expect(argsOf(calls, "vitals.get").slice(1)).toEqual([DAY]);
    expect(argsOf(calls, "water.getIntake").slice(1)).toEqual([DAY]);
    expect(argsOf(calls, "exercise.listByDay").slice(1)).toEqual([DAY]);
    expect(argsOf(calls, "dailyTarget.get").slice(1)).toEqual([DAY]);
  });

  it("resolves the user id once for the whole request, not once per section", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/health-overview?day=${DAY}`, token);

    expect(calls.filter((call) => call.name === "user.getOrCreate")).toHaveLength(1);
  });

  it("ignores a query parameter that tries to choose the section list", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const res = await get(app, `/api/health-overview?day=${DAY}&sections=water&only=bowel`, token);

    const body = (await res.json()) as SectionBody;
    expect(Object.keys(body).sort()).toEqual([...SECTION_KEYS].sort());
  });
});

describe("GET /api/health-overview request-level faults", () => {
  it("rejects a missing day with 400 and no section object", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const res = await get(app, "/api/health-overview", token);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("bad_request");
    for (const key of SECTION_KEYS) expect(body[key]).toBeUndefined();
  });

  it("rejects a malformed day with 400", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    expect((await get(app, "/api/health-overview?day=20-08-2026", token)).status).toBe(400);
    expect((await get(app, "/api/health-overview?day=2026-02-30", token)).status).toBe(400);
  });

  it("rejects an out-of-range window with 400 at both ends", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    expect((await get(app, `/api/health-overview?day=${DAY}&trend_days=400`, token)).status).toBe(400);
    expect((await get(app, `/api/health-overview?day=${DAY}&trend_days=0`, token)).status).toBe(400);
    expect((await get(app, `/api/health-overview?day=${DAY}&care_days=400`, token)).status).toBe(400);
    expect((await get(app, `/api/health-overview?day=${DAY}&trend_days=366`, token)).status).toBe(200);
  });

  it("rejects a missing or invalid bearer token with 401 and no section object", async () => {
    const { app } = buildBatchApp();

    const res = await app.request(`/api/health-overview?day=${DAY}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of SECTION_KEYS) expect(body[key]).toBeUndefined();

    const bad = await app.request(`/api/health-overview?day=${DAY}`, { headers: { Authorization: "Bearer nonsense" } });
    expect(bad.status).toBe(401);
  });
});

describe("GET /api/health-overview per-section isolation", () => {
  it("keeps every other section when one repository really rejects", async () => {
    const { app } = buildBatchApp({ "bowel.get": rejectsWith("bowel query exploded") });
    const token = await validToken();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(app, `/api/health-overview?day=${DAY}`, token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionBody;
    expect(body.bowel).toEqual({ ok: false, error: "unavailable" });
    // Contents, not just the status code: a status-only assertion passes
    // against an empty body.
    expect(body.water.data).toEqual({ day: DAY, total_ml: WATER_TOTAL_ML, target_ml: WATER_TARGET_ML, remaining_ml: WATER_TARGET_ML - WATER_TOTAL_ML });
    expect(body.vitals.data).toMatchObject({ day: DAY, weight_kg: TREND_WEIGHT_KG });
    expect(body.weight_goal.data).toMatchObject({ height_cm: HEIGHT_CM });
    expect(body.exercise.data).toEqual({ day: DAY, entries: [], total_minutes: 0 });
    for (const key of SECTION_KEYS) {
      if (key === "bowel") continue;
      expect(body[key], key).toEqual({ ok: true, data: expect.anything() });
    }
    vi.restoreAllMocks();
  });

  it("still returns 200 with every key when every section fails", async () => {
    const boom = rejectsWith("everything is down");
    const { app } = buildBatchApp({
      "bodyProfile.get": boom,
      "vitals.listRange": boom,
      "vitals.get": boom,
      "healthCalendar.listLoggedDays": boom,
      "meal.listMealsByDay": boom,
      "dailyTarget.get": boom,
      "foodDictionary.listFavorites": boom,
      "water.getTarget": boom,
      "bowel.get": boom,
      "exercise.listByDay": boom,
      "menstrual.listByUser": boom,
      "careItem.listActiveSchedulesForUserOn": boom,
      "careItem.listByUser": boom,
    });
    const token = await validToken();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(app, `/api/health-overview?day=${DAY}`, token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionBody;
    for (const key of SECTION_KEYS) {
      // `exercise_activities` is computed in-process from a static library, so
      // it has no repository to break — it stays ok, and that is the point:
      // the response is a mix, never an all-or-nothing.
      if (key === "exercise_activities") {
        expect(body[key], key).toEqual({ ok: true, data: expect.anything() });
        continue;
      }
      expect(body[key], key).toEqual({ ok: false, error: "unavailable" });
    }
    vi.restoreAllMocks();
  });

  it("leaks none of the failure's text into the response body", async () => {
    const secret = "postgres://life:hunter2@ep-internal.neon.tech:5432/db\n    at Repository.get (/src/db.ts:42)";
    const { app } = buildBatchApp({ "bowel.get": rejectsWith(secret) });
    const token = await validToken();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(app, `/api/health-overview?day=${DAY}`, token);
    const text = await res.text();

    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("ep-internal.neon.tech");
    expect(text).not.toContain("Repository.get");
    expect(text).toContain('"bowel":{"ok":false,"error":"unavailable"}');
    vi.restoreAllMocks();
  });

  it("logs one internal error per failed section", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = buildBatchApp({ "bowel.get": rejectsWith("boom"), "menstrual.listByUser": rejectsWith("boom") });
    const token = await validToken();

    await get(app, `/api/health-overview?day=${DAY}`, token);

    expect(errorSpy.mock.calls.filter((call) => call[0] === "internal error")).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it("does not cancel sections still in flight when one rejects immediately", async () => {
    let releaseSlow: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let slowFinished = false;
    const { app } = buildBatchApp({
      "bowel.get": rejectsWith("immediate"),
      "water.getIntake": async (...args: unknown[]) => {
        await slow;
        slowFinished = true;
        return { userId: "user-1", day: args[1] as string, totalMl: WATER_TOTAL_ML };
      },
    });
    const token = await validToken();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const pending = get(app, `/api/health-overview?day=${DAY}`, token);
    releaseSlow?.();
    const body = (await (await pending).json()) as SectionBody;

    expect(slowFinished).toBe(true);
    expect(body.bowel).toEqual({ ok: false, error: "unavailable" });
    expect(body.water.data).toMatchObject({ total_ml: WATER_TOTAL_ML });
    vi.restoreAllMocks();
  });
});

describe("GET /api/health-overview per-section timeout", () => {
  // TEST HAZARD (tasks 6.8/6.9): with a repository that settles — even slowly
  // — this test passes with the fuse deleted. The fake must never settle.
  it("reports a never-settling section as unavailable and returns the rest", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = buildBatchApp({ "bowel.get": neverSettles() });
    const token = await validToken();

    const pending = get(app, `/api/health-overview?day=${DAY}`, token);
    await vi.advanceTimersByTimeAsync(8_000);
    const res = await pending;

    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionBody;
    expect(body.bowel).toEqual({ ok: false, error: "unavailable" });
    for (const key of SECTION_KEYS) {
      expect(body[key], key).toBeDefined();
      expect(body[key], key).not.toBeNull();
    }
    expect(body.water.data).toEqual({ day: DAY, total_ml: WATER_TOTAL_ML, target_ml: WATER_TARGET_ML, remaining_ml: WATER_TARGET_ML - WATER_TOTAL_ML });
    expect(body.vitals.data).toMatchObject({ day: DAY, weight_kg: TREND_WEIGHT_KG });
    expect(body.menstrual.data).toMatchObject({ periods: [expect.objectContaining({ start_date: "2026-07-20" })] });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("GET /api/health-overview payload equality with the granular endpoints", () => {
  it("matches GET /api/water for the same day", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const batch = (await (await get(app, `/api/health-overview?day=${DAY}`, token)).json()) as SectionBody;
    const granular = await (await get(app, `/api/water?day=${DAY}`, token)).json();

    expect(batch.water.data).toEqual(granular);
  });

  it("matches GET /api/vitals/range for the window it derives", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const batch = (await (await get(app, `/api/health-overview?day=${DAY}&trend_days=7`, token)).json()) as SectionBody;
    const granular = await (await get(app, `/api/vitals/range?from=2026-08-14&to=${DAY}`, token)).json();

    expect(batch.vitals_trend.data).toEqual(granular);
  });

  it("matches the other granular endpoints section by section", async () => {
    const { app } = buildBatchApp();
    const token = await validToken();

    const batch = (await (await get(app, `/api/health-overview?day=${DAY}`, token)).json()) as SectionBody;

    expect(batch.bowel.data).toEqual(await (await get(app, `/api/bowel?day=${DAY}`, token)).json());
    expect(batch.vitals.data).toEqual(await (await get(app, `/api/vitals?day=${DAY}`, token)).json());
    expect(batch.meals.data).toEqual(await (await get(app, `/api/meals?day=${DAY}`, token)).json());
    expect(batch.daily_target.data).toEqual(await (await get(app, `/api/daily-target?day=${DAY}`, token)).json());
    expect(batch.exercise.data).toEqual(await (await get(app, `/api/exercise?day=${DAY}`, token)).json());
    expect(batch.exercise_activities.data).toEqual(await (await get(app, "/api/exercise/activities", token)).json());
    expect(batch.weight_goal.data).toEqual(await (await get(app, "/api/weight-goal", token)).json());
    expect(batch.menstrual.data).toEqual(await (await get(app, "/api/menstrual", token)).json());
    expect(batch.favorite_food_items.data).toEqual(await (await get(app, "/api/food-items/favorites", token)).json());
    expect(batch.health_calendar.data).toEqual(
      await (await get(app, `/api/health-calendar?month=2026-08&today=${DAY}`, token)).json(),
    );
    expect(batch.care_today.data).toEqual(await (await get(app, "/api/care/today", token)).json());
    expect(batch.care_range.data).toEqual(await (await get(app, `/api/care/range?from=2026-07-22&to=${DAY}`, token)).json());
  });
});

describe("GET /api/health-overview query budget (Workers subrequest ceiling)", () => {
  /**
   * design.md D6: every repository read is (normally) one `neon-http`
   * request, and the Workers Free plan caps subrequests per request at 50
   * (docs read 2026-08-20). The fakes here take the worst-case branch of
   * every carry-forward read, so adding a section trips this assertion
   * instead of production — but this counts repository *calls*, which only
   * equals subrequest count for repositories that issue exactly one query
   * per call. `DrizzleFinanceBudgetRepository.listWithSpent` used to violate
   * that (one query per budget row, invisible to a fake stubbing a single
   * budget) until it was rewritten as one aggregate query
   * (`finance-budget-spent.test.ts` pins it at the SQL level); this count is
   * only trustworthy as long as that invariant — one call, one query — holds
   * for every repository method the batch endpoints call. It is not
   * mechanically enforced here.
   */
  it("issues 28 repository reads in the worst case", async () => {
    const { app, calls } = buildBatchApp();
    const token = await validToken();

    await get(app, `/api/health-overview?day=${DAY}`, token);

    expect(calls.length).toBe(28);
    expect(calls.length).toBeLessThan(50);
  });
});
