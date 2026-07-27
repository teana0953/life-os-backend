import { beforeEach, describe, expect, it } from "vitest";
import { importChaodaysDiet, nextSnackName } from "../../../../src/contexts/health/application/import-chaodays-diet";
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../../../src/contexts/health/domain/chaodays-client";
import type {
  ChaodaysClient,
  ChaodaysDietRecord,
  ChaodaysSession,
} from "../../../../src/contexts/health/domain/chaodays-client";
import type { MealEntry, MealItem, MealSummary } from "../../../../src/contexts/health/domain/meal-entry";
import type {
  CreateMealEntryInput,
  CreateMealItemForEntryInput,
  CreateMealItemInput,
  MealRepository,
  UpdateMealItemPatch,
  UpsertMealWithItemsInput,
} from "../../../../src/contexts/health/domain/meal-repository";
import type { VitalsRecord } from "../../../../src/contexts/health/domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../../../../src/contexts/health/domain/vitals-repository";

type StoredMeal = MealSummary & { items: MealItem[] };

class InMemoryMealRepository implements MealRepository {
  meals: StoredMeal[] = [];
  private nextMealId = 1;
  private nextItemId = 1;
  createMealsCallCount = 0;

  /** Test helper: seed a pre-existing meal (with no items) for a user/day/meal. */
  seed(userId: string, day: string, meal: string, time: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.meals.push({
      id: `meal-${this.nextMealId++}`,
      userId,
      day,
      meal,
      time,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      items: [],
    });
  }

  async upsertMealWithItems(input: UpsertMealWithItemsInput): Promise<MealEntry> {
    let meal = this.meals.find((m) => m.userId === input.userId && m.day === input.day && m.meal === input.meal);
    if (!meal) {
      meal = {
        id: `meal-${this.nextMealId++}`,
        userId: input.userId,
        day: input.day,
        meal: input.meal,
        time: input.time ?? new Date(),
        createdAt: new Date(),
        items: [],
      };
      this.meals.push(meal);
    }
    for (const item of input.items) {
      meal.items.push(this.toStoredItem(meal.id, item));
    }
    return meal;
  }

  async createMeals(entries: CreateMealEntryInput[], items: CreateMealItemForEntryInput[]): Promise<void> {
    this.createMealsCallCount++;
    for (const entry of entries) {
      const entryItems = items.filter((item) => item.mealEntryId === entry.id).map((item) => this.toStoredItem(entry.id, item));
      this.meals.push({ id: entry.id, userId: entry.userId, day: entry.day, meal: entry.meal, time: entry.time, createdAt: new Date(), items: entryItems });
    }
  }

  private toStoredItem(mealEntryId: string, item: CreateMealItemInput): MealItem {
    return { id: `item-${this.nextItemId++}`, mealEntryId, createdAt: new Date(), ...item };
  }

  async listMealsByDay(userId: string, day: string): Promise<MealEntry[]> {
    return this.meals.filter((m) => m.userId === userId && m.day === day);
  }

  async listMealsInRange(userId: string, from: string, to: string): Promise<MealEntry[]> {
    return this.meals.filter((m) => m.userId === userId && m.day >= from && m.day <= to);
  }

  async listLoggedDays(): Promise<string[]> {
    throw new Error("not used in this test");
  }

  async updateMealTime(): Promise<MealSummary | null> {
    throw new Error("not used in this test");
  }

  async deleteMeal(): Promise<boolean> {
    throw new Error("not used in this test");
  }

  async updateItem(_userId: string, _itemId: string, _patch: UpdateMealItemPatch): Promise<MealItem | null> {
    throw new Error("not used in this test");
  }

  async deleteItem(): Promise<boolean> {
    throw new Error("not used in this test");
  }
}

class InMemoryVitalsRepository implements VitalsRepository {
  private byUserDay = new Map<string, VitalsRecord>();
  setManyCallCount = 0;

  seed(record: VitalsRecord) {
    this.byUserDay.set(`${record.userId}:${record.day}`, record);
  }

  async get(userId: string, day: string): Promise<VitalsRecord | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetVitalsInput): Promise<VitalsRecord> {
    const record: VitalsRecord = {
      userId: input.userId,
      day: input.day,
      weightKg: input.weightKg,
      bodyFatPct: input.bodyFatPct,
      bpReadings: input.bpReadings,
      glucoseReadings: input.glucoseReadings,
      spo2Readings: input.spo2Readings,
    };
    this.byUserDay.set(`${input.userId}:${input.day}`, record);
    return record;
  }

  async setMany(rows: SetVitalsInput[]): Promise<void> {
    this.setManyCallCount++;
    for (const row of rows) {
      await this.set(row);
    }
  }

  async getLatestWeight(): Promise<number | null> {
    throw new Error("not used in this test");
  }

  async getEarliestWeight(): Promise<number | null> {
    throw new Error("not used in this test");
  }

  async getWeightDayCount(): Promise<number> {
    throw new Error("not used in this test");
  }

  async listRange(userId: string, from: string, to: string): Promise<VitalsRecord[]> {
    return [...this.byUserDay.values()].filter((r) => r.userId === userId && r.day >= from && r.day <= to);
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

class FakeChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysDietRecord[] = [];
  signInArgs: { uid: string; password: string } | null = null;
  fetchArgs: { from: string; to: string } | null = null;
  signInCallCount = 0;
  fetchCalls: { from: string; to: string }[] = [];
  /**
   * How the fake spreads its records over the fetches:
   * - "range": each call returns only the records inside `[from, to]`, like the
   *   real client. Returning every record on every call instead would merge each
   *   day's meals once per batch and re-number its snacks.
   * - "all-at-once": the first call returns every record and later calls return
   *   none — what a single request for the whole range looks like.
   */
  delivery: "range" | "all-at-once" = "range";
  /** When set, the fetch with this 1-based call number throws instead of returning. */
  failOnFetchCall: number | null = null;

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    this.signInArgs = { uid, password };
    this.signInCallCount++;
    if (this.signInError) throw this.signInError;
    return SESSION;
  }

  fetchWeightRecords(): never {
    throw new Error("not used in this test");
  }

  async fetchDietRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysDietRecord[] }> {
    this.fetchArgs = { from, to };
    this.fetchCalls.push({ from, to });
    if (this.fetchCalls.length === this.failOnFetchCall) throw new ChaodaysUpstreamError("status_502");
    if (this.delivery === "all-at-once") {
      return { session, records: this.fetchCalls.length === 1 ? this.records : [] };
    }
    return { session, records: this.records.filter((r) => r.date >= from && r.date <= to) };
  }

  fetchWaterRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDefecationRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDietMenus(): never {
    throw new Error("not used in this test");
  }
}

/** The day after `day`, computed in UTC. */
function dayAfter(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Asserts `calls` are several contiguous, non-overlapping sub-ranges covering exactly `[from, to]`. */
function expectContiguousCover(calls: { from: string; to: string }[], from: string, to: string) {
  expect(calls.length).toBeGreaterThan(1);
  expect(calls[0].from).toBe(from);
  expect(calls[calls.length - 1].to).toBe(to);
  for (let i = 1; i < calls.length; i++) {
    expect(calls[i].from).toBe(dayAfter(calls[i - 1].to));
  }
}

/** Everything written to `repository`, minus the generated ids/timestamps, in a stable order. */
function writtenMeals(repository: InMemoryMealRepository) {
  return repository.meals
    .map(({ id: _id, createdAt: _createdAt, items, ...meal }) => ({
      ...meal,
      time: meal.time.toISOString(),
      items: items.map(({ id: _itemId, mealEntryId: _mealEntryId, createdAt: _itemCreatedAt, ...item }) => item),
    }))
    .sort((a, b) => `${a.day}|${a.meal}`.localeCompare(`${b.day}|${b.meal}`));
}

let mealRepository: InMemoryMealRepository;
let vitalsRepository: InMemoryVitalsRepository;
let chaodaysClient: FakeChaodaysClient;

beforeEach(() => {
  mealRepository = new InMemoryMealRepository();
  vitalsRepository = new InMemoryVitalsRepository();
  chaodaysClient = new FakeChaodaysClient();
});

const BASE_INPUT = {
  userId: "user-1",
  uid: "chaodays-uid",
  password: "chaodays-pw",
  from: "2026-07-01",
  to: "2026-07-01",
};

describe("importChaodaysDiet", () => {
  it("maps meal types and imports food items with portions", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "lunch",
        recordedAt: "2026-07-01 12:30",
        items: [{ name: "白飯", staple: 2, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    expect(summary).toEqual({ mealsImported: 1, mealsSkipped: 0, glucoseImported: 0, from: "2026-07-01", to: "2026-07-01" });
    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals).toHaveLength(1);
    expect(meals[0].meal).toBe("lunch");
    expect(meals[0].items).toHaveLength(1);
    expect(meals[0].items[0]).toMatchObject({ name: "白飯", staple: 2, meat: 0, fruit: 0, veg: 0, unclassified: false });
    // The credentials and range thread through to the client unchanged.
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchArgs).toEqual({ from: "2026-07-01", to: "2026-07-01" });
  });

  it.each([
    ["breakfast", "breakfast"],
    ["dinner", "dinner"],
    ["extra", "點心"],
  ])("maps chaodays record_type %s to %s", async (recordType, expectedMeal) => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: recordType as ChaodaysDietRecord["recordType"],
        recordedAt: "2026-07-01 08:00",
        items: [{ name: "白飯", staple: 1, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals[0].meal).toBe(expectedMeal);
  });

  it("interprets recorded_at at the chaodays (+08:00) offset, not UTC", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "breakfast",
        recordedAt: "2026-07-01 08:30",
        items: [{ name: "白粥", staple: 1, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals[0].time.toISOString()).toBe("2026-07-01T00:30:00.000Z");
  });

  it("does not create a meal item for a portionless / glucose-only diet item, but still extracts its glucose", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "breakfast",
        recordedAt: "2026-07-01 07:30",
        items: [{ name: "前血糖：93", staple: 0, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    // No food item → no meal created at all for this meal type.
    expect(summary.mealsImported).toBe(0);
    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals).toHaveLength(0);
    expect(summary.glucoseImported).toBe(1);
    const vitals = await vitalsRepository.get("user-1", "2026-07-01");
    expect(vitals?.glucoseReadings).toEqual([{ label: "餐前", value: 93, mealContext: "pre_meal", time: "07:30" }]);
  });

  it("strips glucose text from a mixed food+glucose item name before storing it", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "breakfast",
        recordedAt: "2026-07-01 07:30",
        items: [{ name: "一根香蕉\n前血糖：70\n後血糖(2hr)：102", staple: 0, meat: 0, fruit: 1, veg: 0 }],
      },
    ];

    await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals[0].items[0].name).toBe("一根香蕉");
  });

  it("skips a record with an unrecognized record_type (no meal, no crash)", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "midnight" as ChaodaysDietRecord["recordType"],
        recordedAt: "2026-07-01 23:30",
        items: [{ name: "泡麵", staple: 2, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    expect(summary.mealsImported).toBe(0);
    expect(await mealRepository.listMealsByDay("user-1", "2026-07-01")).toEqual([]);
  });

  it("merges extra records at the same time into a single snack", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "extra",
        recordedAt: "2026-07-01 10:00",
        items: [{ name: "堅果", staple: 0, meat: 1, fruit: 0, veg: 0 }],
      },
      {
        date: "2026-07-01",
        recordType: "extra",
        recordedAt: "2026-07-01 10:00",
        items: [{ name: "餅乾", staple: 1, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    expect(summary.mealsImported).toBe(1);
    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals).toHaveLength(1);
    expect(meals[0].meal).toBe("點心");
    expect(meals[0].items.map((i) => i.name)).toEqual(["堅果", "餅乾"]);
  });

  it("splits extra records at different times into separate snack meals, named by the app's snack rule", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "extra",
        recordedAt: "2026-07-01 21:00",
        items: [{ name: "泡麵", staple: 2, meat: 0, fruit: 0, veg: 0 }],
      },
      {
        date: "2026-07-01",
        recordType: "extra",
        recordedAt: "2026-07-01 10:00",
        items: [{ name: "堅果", staple: 0, meat: 1, fruit: 0, veg: 0 }],
      },
      {
        date: "2026-07-01",
        recordType: "extra",
        recordedAt: "2026-07-01 15:00",
        items: [{ name: "餅乾", staple: 1, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    expect(summary.mealsImported).toBe(3);
    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals).toHaveLength(3);

    const bySnackName = new Map(meals.map((m) => [m.meal, m]));
    expect([...bySnackName.keys()].sort()).toEqual(["點心", "點心2", "點心3"]);

    const first = bySnackName.get("點心")!;
    expect(first.items.map((i) => i.name)).toEqual(["堅果"]);
    expect(first.time.toISOString()).toBe("2026-07-01T02:00:00.000Z");

    const second = bySnackName.get("點心2")!;
    expect(second.items.map((i) => i.name)).toEqual(["餅乾"]);
    expect(second.time.toISOString()).toBe("2026-07-01T07:00:00.000Z");

    const third = bySnackName.get("點心3")!;
    expect(third.items.map((i) => i.name)).toEqual(["泡麵"]);
    expect(third.time.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("skips a snack time that already exists that day, and continues numbering from the day's existing snacks", async () => {
    // Existing "點心" at 10:00+08:00 (== 2026-07-01T02:00:00.000Z).
    mealRepository.seed("user-1", "2026-07-01", "點心", new Date("2026-07-01T02:00:00.000Z"));
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "extra",
        recordedAt: "2026-07-01 10:00", // same time as the existing snack -> skipped
        items: [{ name: "堅果", staple: 0, meat: 1, fruit: 0, veg: 0 }],
      },
      {
        date: "2026-07-01",
        recordType: "extra",
        recordedAt: "2026-07-01 15:00", // new time -> creates 點心2
        items: [{ name: "餅乾", staple: 1, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    expect(summary).toEqual({ mealsImported: 1, mealsSkipped: 1, glucoseImported: 0, from: "2026-07-01", to: "2026-07-01" });
    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals).toHaveLength(2);
    const newSnack = meals.find((m) => m.meal === "點心2");
    expect(newSnack?.items.map((i) => i.name)).toEqual(["餅乾"]);
  });

  it("skips a standard-meal code that already existed before the import (judged from a pre-import snapshot)", async () => {
    mealRepository.seed("user-1", "2026-07-01", "breakfast");
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "breakfast",
        recordedAt: "2026-07-01 07:00",
        items: [{ name: "白粥", staple: 1, meat: 0, fruit: 0, veg: 0 }],
      },
      {
        date: "2026-07-01",
        recordType: "breakfast",
        recordedAt: "2026-07-01 07:30",
        items: [{ name: "豆漿", staple: 0, meat: 1, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    // Skipped once for the meal code, not once per record.
    expect(summary).toEqual({ mealsImported: 0, mealsSkipped: 1, glucoseImported: 0, from: "2026-07-01", to: "2026-07-01" });
    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals).toHaveLength(1);
    expect(meals[0].items).toHaveLength(0);
  });

  it("extracts glucose from a portionless extra item without creating a snack meal", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "extra",
        recordedAt: "2026-07-01 15:30",
        items: [{ name: "前血糖：93", staple: 0, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    expect(summary.mealsImported).toBe(0);
    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals).toHaveLength(0);
    expect(summary.glucoseImported).toBe(1);
    const vitals = await vitalsRepository.get("user-1", "2026-07-01");
    expect(vitals?.glucoseReadings).toEqual([{ label: "餐前", value: 93, mealContext: "pre_meal", time: "15:30" }]);
  });

  it("appends new glucose readings, dedups against existing, and preserves other vitals fields", async () => {
    vitalsRepository.seed({
      userId: "user-1",
      day: "2026-07-01",
      weightKg: 60,
      bodyFatPct: 20,
      bpReadings: [{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }],
      glucoseReadings: [{ label: "餐前", value: 93, mealContext: "pre_meal", time: "07:30" }],
      spo2Readings: [{ spo2: 98, pulse: 71, time: "08:30" }],
    });
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "breakfast",
        recordedAt: "2026-07-01 07:30",
        items: [
          {
            name: "前血糖：93\n後血糖(1hr)：140\n後血糖(2hr)：102",
            staple: 0,
            meat: 0,
            fruit: 0,
            veg: 0,
          },
        ],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    // Pre-meal 93@07:30 already existed → not duplicated; the two post-meal
    // readings (same time, different hour-marker labels) are both new.
    expect(summary.glucoseImported).toBe(2);
    const vitals = await vitalsRepository.get("user-1", "2026-07-01");
    expect(vitals?.glucoseReadings).toEqual([
      { label: "餐前", value: 93, mealContext: "pre_meal", time: "07:30" },
      { label: "餐後1hr", value: 140, mealContext: "post_meal", time: "07:30" },
      { label: "餐後2hr", value: 102, mealContext: "post_meal", time: "07:30" },
    ]);
    expect(vitals?.weightKg).toBe(60);
    expect(vitals?.bodyFatPct).toBe(20);
    expect(vitals?.bpReadings).toEqual([{ systolic: 120, diastolic: 80, pulse: 70, time: "08:30" }]);
    expect(vitals?.spo2Readings).toEqual([{ spo2: 98, pulse: 71, time: "08:30" }]);
  });

  it("persists a multi-day range via one createMeals call and one setMany call, not per-day", async () => {
    chaodaysClient.records = [
      {
        date: "2026-07-01",
        recordType: "breakfast",
        recordedAt: "2026-07-01 07:30",
        items: [{ name: "白粥\n前血糖：93", staple: 1, meat: 0, fruit: 0, veg: 0 }],
      },
      {
        date: "2026-07-02",
        recordType: "lunch",
        recordedAt: "2026-07-02 12:30",
        items: [{ name: "白飯\n前血糖：98", staple: 2, meat: 0, fruit: 0, veg: 0 }],
      },
      {
        date: "2026-07-03",
        recordType: "dinner",
        recordedAt: "2026-07-03 18:30",
        items: [{ name: "麵\n前血糖：101", staple: 2, meat: 0, fruit: 0, veg: 0 }],
      },
    ];
    const input = { ...BASE_INPUT, from: "2026-07-01", to: "2026-07-03" };

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, input);

    expect(summary).toEqual({ mealsImported: 3, mealsSkipped: 0, glucoseImported: 3, from: "2026-07-01", to: "2026-07-03" });
    // Regardless of the number of days/meals, persistence is one batched call each.
    expect(mealRepository.createMealsCallCount).toBe(1);
    expect(vitalsRepository.setManyCallCount).toBe(1);
    expect(await mealRepository.listMealsByDay("user-1", "2026-07-01")).toHaveLength(1);
    expect(await mealRepository.listMealsByDay("user-1", "2026-07-02")).toHaveLength(1);
    expect(await mealRepository.listMealsByDay("user-1", "2026-07-03")).toHaveLength(1);
  });

  it("performs zero writes (no createMeals/setMany calls) for an empty range", async () => {
    chaodaysClient.records = [];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    expect(summary).toEqual({ mealsImported: 0, mealsSkipped: 0, glucoseImported: 0, from: "2026-07-01", to: "2026-07-01" });
    expect(mealRepository.createMealsCallCount).toBe(0);
    expect(vitalsRepository.setManyCallCount).toBe(0);
  });

  // Days on both sides of the first 183-day boundary (2026-07-02 / 2026-07-03),
  // each with several same-type records to merge and several snacks to number.
  const LONG_RANGE_RECORDS: ChaodaysDietRecord[] = [
    {
      date: "2026-01-01",
      recordType: "lunch",
      recordedAt: "2026-01-01 12:00",
      items: [{ name: "白飯", staple: 2, meat: 0, fruit: 0, veg: 0 }],
    },
    {
      date: "2026-01-01",
      recordType: "lunch",
      recordedAt: "2026-01-01 12:45",
      items: [{ name: "青菜", staple: 0, meat: 0, fruit: 0, veg: 1 }],
    },
    {
      date: "2026-07-02",
      recordType: "breakfast",
      recordedAt: "2026-07-02 07:30",
      items: [{ name: "白粥", staple: 1, meat: 0, fruit: 0, veg: 0 }],
    },
    {
      date: "2026-07-02",
      recordType: "extra",
      recordedAt: "2026-07-02 09:00",
      items: [{ name: "蘋果", staple: 0, meat: 0, fruit: 1, veg: 0 }],
    },
    {
      date: "2026-07-02",
      recordType: "extra",
      recordedAt: "2026-07-02 15:00",
      items: [{ name: "餅乾", staple: 1, meat: 0, fruit: 0, veg: 0 }],
    },
    {
      date: "2026-07-03",
      recordType: "extra",
      recordedAt: "2026-07-03 10:00",
      items: [{ name: "香蕉", staple: 0, meat: 0, fruit: 1, veg: 0 }],
    },
    {
      date: "2026-07-03",
      recordType: "extra",
      recordedAt: "2026-07-03 10:00",
      items: [{ name: "牛奶", staple: 0, meat: 1, fruit: 0, veg: 0 }],
    },
    {
      date: "2026-07-03",
      recordType: "extra",
      recordedAt: "2026-07-03 16:00",
      items: [{ name: "麵包", staple: 1, meat: 0, fruit: 0, veg: 0 }],
    },
    {
      date: "2027-12-31",
      recordType: "dinner",
      recordedAt: "2027-12-31 18:00",
      items: [
        { name: "魚", staple: 0, meat: 2, fruit: 0, veg: 0 },
        { name: "前血糖：110", staple: 0, meat: 0, fruit: 0, veg: 0 },
      ],
    },
  ];

  const LONG_RANGE_INPUT = {
    userId: "user-1",
    uid: "chaodays-uid",
    password: "chaodays-pw",
    from: "2026-01-01",
    to: "2027-12-31",
  };

  it("fetches a range longer than the batch size as several contiguous requests, signing in once", async () => {
    chaodaysClient.records = LONG_RANGE_RECORDS;

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, LONG_RANGE_INPUT);

    expectContiguousCover(chaodaysClient.fetchCalls, "2026-01-01", "2027-12-31");
    expect(chaodaysClient.signInCallCount).toBe(1);
    expect(summary).toEqual({
      mealsImported: 7,
      mealsSkipped: 0,
      glucoseImported: 1,
      from: "2026-01-01",
      to: "2027-12-31",
    });
    // Each of the two days straddling a batch boundary numbers its own snacks
    // from scratch, exactly as it would in a single request.
    expect((await mealRepository.listMealsByDay("user-1", "2026-07-02")).map((m) => m.meal)).toEqual([
      "breakfast",
      "點心",
      "點心2",
    ]);
    expect((await mealRepository.listMealsByDay("user-1", "2026-07-03")).map((m) => m.meal)).toEqual(["點心", "點心2"]);
  });

  it("writes the same meals, glucose and summary whether the range arrived in one response or several batches", async () => {
    const singleRequestMealRepository = new InMemoryMealRepository();
    const singleRequestVitalsRepository = new InMemoryVitalsRepository();
    const singleRequestClient = new FakeChaodaysClient();
    singleRequestClient.records = LONG_RANGE_RECORDS;
    singleRequestClient.delivery = "all-at-once";
    const singleRequestSummary = await importChaodaysDiet(
      singleRequestMealRepository,
      singleRequestVitalsRepository,
      singleRequestClient,
      LONG_RANGE_INPUT,
    );

    chaodaysClient.records = LONG_RANGE_RECORDS;
    const batchedSummary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, LONG_RANGE_INPUT);

    expect(chaodaysClient.fetchCalls.length).toBeGreaterThan(1);
    expect(batchedSummary).toEqual(singleRequestSummary);
    expect(writtenMeals(mealRepository)).toEqual(writtenMeals(singleRequestMealRepository));
    expect(await vitalsRepository.listRange("user-1", LONG_RANGE_INPUT.from, LONG_RANGE_INPUT.to)).toEqual(
      await singleRequestVitalsRepository.listRange("user-1", LONG_RANGE_INPUT.from, LONG_RANGE_INPUT.to),
    );
    // Pinned, so both runs being wrong the same way would still fail: same-type
    // records merge into one meal, and same-time snacks into one snack.
    const lunch = (await mealRepository.listMealsByDay("user-1", "2026-01-01"))[0];
    expect(lunch.meal).toBe("lunch");
    expect(lunch.items.map((item) => item.name)).toEqual(["白飯", "青菜"]);
    const snacks = await mealRepository.listMealsByDay("user-1", "2026-07-03");
    expect(snacks.map((m) => m.meal)).toEqual(["點心", "點心2"]);
    expect(snacks[0].items.map((item) => item.name)).toEqual(["香蕉", "牛奶"]);
  });

  it("writes nothing when a batch after the first fails", async () => {
    // The first batch carries 2026-01-01's lunch, so a per-batch write would
    // already have landed it (and its glucose) before the failure.
    chaodaysClient.records = LONG_RANGE_RECORDS;
    chaodaysClient.failOnFetchCall = 2;

    await expect(
      importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, LONG_RANGE_INPUT),
    ).rejects.toThrow(ChaodaysUpstreamError);

    // The first batch did succeed, and no further batch was issued.
    expect(chaodaysClient.fetchCalls.length).toBe(2);
    // A failed import leaves the range untouched, so a retry is a clean retry.
    expect(mealRepository.createMealsCallCount).toBe(0);
    expect(vitalsRepository.setManyCallCount).toBe(0);
    expect(mealRepository.meals).toEqual([]);
    expect(await vitalsRepository.listRange("user-1", LONG_RANGE_INPUT.from, LONG_RANGE_INPUT.to)).toEqual([]);
  });

  it("propagates a chaodays sign-in auth failure", async () => {
    chaodaysClient.signInError = new ChaodaysAuthError();

    await expect(
      importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT),
    ).rejects.toThrow(ChaodaysAuthError);
  });
});

describe("nextSnackName", () => {
  it("returns the base word when no existing name matches the snack series", () => {
    expect(nextSnackName([])).toBe("點心");
    expect(nextSnackName(["breakfast", "下午茶"])).toBe("點心");
  });

  it("returns the base word + 2 when a bare base word already exists (counts as 1)", () => {
    expect(nextSnackName(["點心"])).toBe("點心2");
  });

  it("returns one more than the highest existing series number", () => {
    expect(nextSnackName(["點心", "點心2"])).toBe("點心3");
    expect(nextSnackName(["點心3"])).toBe("點心4");
  });

  it("ignores non-matching names alongside series names", () => {
    expect(nextSnackName(["breakfast", "點心2", "下午茶"])).toBe("點心3");
  });
});
