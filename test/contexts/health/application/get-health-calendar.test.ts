import { describe, expect, it } from "vitest";
import { getHealthCalendar } from "../../../../src/contexts/health/application/get-health-calendar";
import type { DailyTarget } from "../../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../../../../src/contexts/health/domain/daily-target-repository";
import type { HealthCalendarRepository } from "../../../../src/contexts/health/domain/health-calendar-repository";
import type { MealEntry, MealItem } from "../../../../src/contexts/health/domain/meal-entry";
import type { MealRepository } from "../../../../src/contexts/health/domain/meal-repository";

class FakeCalendarRepository implements HealthCalendarRepository {
  constructor(private readonly days: string[]) {}
  async listLoggedDays(_userId: string, from: string, to: string): Promise<string[]> {
    return this.days.filter((d) => d >= from && d <= to).sort();
  }
}

class FakeDailyTargetRepository implements DailyTargetRepository {
  private byDay = new Map<string, DailyTarget>();
  seed(day: string, baseStaple: number): void {
    this.byDay.set(day, {
      id: day,
      userId: "user-1",
      day,
      baseStaple,
      baseMeat: 0,
      baseFruit: 0,
      baseVeg: 0,
      bonusStaple: 0,
      bonusMeat: 0,
      bonusFruit: 0,
      bonusVeg: 0,
    });
  }
  async get(_userId: string, day: string): Promise<DailyTarget | null> {
    return this.byDay.get(day) ?? null;
  }
  async getLatestOnOrBefore(_userId: string, day: string): Promise<DailyTarget | null> {
    let latest: DailyTarget | null = null;
    for (const t of this.byDay.values()) {
      if (t.day <= day && (!latest || t.day > latest.day)) latest = t;
    }
    return latest;
  }
  async set(_input: SetDailyTargetInput): Promise<DailyTarget> {
    throw new Error("not used");
  }
}

/** A meal item carrying only food-group portions (nutrients zeroed, quantity 1). */
function mealItem(staple: number): MealItem {
  return {
    id: "item",
    mealEntryId: "meal",
    foodItemId: null,
    name: null,
    photoRef: null,
    source: "manual",
    unclassified: false,
    carbG: 0,
    proteinG: 0,
    fatG: 0,
    sugarG: 0,
    fiberG: 0,
    kcal: 0,
    staple,
    meat: 0,
    fruit: 0,
    veg: 0,
    quantity: 1,
    baseAmount: null,
    measureUnit: null,
    createdAt: new Date(0),
  };
}

class FakeMealRepository implements MealRepository {
  private byDay = new Map<string, MealItem[]>();
  seed(day: string, items: MealItem[]): void {
    this.byDay.set(day, items);
  }
  async listMealsByDay(_userId: string, day: string): Promise<MealEntry[]> {
    const items = this.byDay.get(day);
    if (!items) return [];
    return [
      { id: "meal", userId: "user-1", day, meal: "lunch", time: new Date(0), createdAt: new Date(0), items },
    ];
  }
  // Unused by the calendar use case.
  upsertMealWithItems(): never { throw new Error("not used"); }
  listLoggedDays(): never { throw new Error("not used"); }
  updateMealTime(): never { throw new Error("not used"); }
  deleteMeal(): never { throw new Error("not used"); }
  updateItem(): never { throw new Error("not used"); }
  deleteItem(): never { throw new Error("not used"); }
}

describe("getHealthCalendar", () => {
  it("reports logged days and rates for a completed past month", async () => {
    const calendar = new FakeCalendarRepository(["2026-06-03", "2026-06-10", "2026-06-20"]);
    const summary = await getHealthCalendar(
      calendar,
      new FakeDailyTargetRepository(),
      new FakeMealRepository(),
      "user-1",
      2026,
      6,
      "2026-07-15", // a later month → June is fully elapsed (30 days)
    );

    expect(summary.loggedDays).toEqual(["2026-06-03", "2026-06-10", "2026-06-20"]);
    expect(summary.daysElapsed).toBe(30);
    expect(summary.loggingRate).toBe(10); // round(100 * 3 / 30)
    expect(summary.dietAdherenceRate).toBe(0); // no targets set → no met days
  });

  it("bounds the current month to today and excludes later days from the rate", async () => {
    // Two logged days on/before today, one after → only the first two count.
    const calendar = new FakeCalendarRepository(["2026-07-02", "2026-07-08", "2026-07-25"]);
    const summary = await getHealthCalendar(
      calendar,
      new FakeDailyTargetRepository(),
      new FakeMealRepository(),
      "user-1",
      2026,
      7,
      "2026-07-10",
    );

    expect(summary.daysElapsed).toBe(10);
    expect(summary.loggingRate).toBe(20); // round(100 * 2 / 10), the 07-25 day is excluded
    expect(summary.loggedDays).toContain("2026-07-25"); // still returned for the calendar
  });

  it("has no elapsed days for a future month", async () => {
    const summary = await getHealthCalendar(
      new FakeCalendarRepository([]),
      new FakeDailyTargetRepository(),
      new FakeMealRepository(),
      "user-1",
      2026,
      9,
      "2026-07-10",
    );

    expect(summary.daysElapsed).toBe(0);
    expect(summary.loggingRate).toBeNull();
    expect(summary.dietAdherenceRate).toBeNull();
  });

  it("counts a day whose diet target is fully met", async () => {
    const targets = new FakeDailyTargetRepository();
    targets.seed("2026-06-01", 2); // carries forward to the whole month
    const meals = new FakeMealRepository();
    meals.seed("2026-06-01", [mealItem(2)]); // meets the 2-staple target on day 1 only

    const summary = await getHealthCalendar(
      new FakeCalendarRepository([]),
      targets,
      meals,
      "user-1",
      2026,
      6,
      "2026-07-01",
    );

    // Day 1 is met; days 2–30 carry the target but have no meals → unmet.
    expect(summary.dietAdherenceRate).toBe(3); // round(100 * 1 / 30)
  });
});
