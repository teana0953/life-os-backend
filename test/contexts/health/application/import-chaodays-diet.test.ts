import { beforeEach, describe, expect, it } from "vitest";
import { importChaodaysDiet } from "../../../../src/contexts/health/application/import-chaodays-diet";
import { ChaodaysAuthError } from "../../../../src/contexts/health/domain/chaodays-client";
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
  seed(userId: string, day: string, meal: string) {
    this.meals.push({
      id: `meal-${this.nextMealId++}`,
      userId,
      day,
      meal,
      time: new Date("2026-01-01T00:00:00.000Z"),
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

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    this.signInArgs = { uid, password };
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
    return { session, records: this.records };
  }

  fetchWaterRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDefecationRecords(): never {
    throw new Error("not used in this test");
  }
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
    expect(meals[0].meal).toBe("午餐");
    expect(meals[0].items).toHaveLength(1);
    expect(meals[0].items[0]).toMatchObject({ name: "白飯", staple: 2, meat: 0, fruit: 0, veg: 0, unclassified: false });
    // The credentials and range thread through to the client unchanged.
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchArgs).toEqual({ from: "2026-07-01", to: "2026-07-01" });
  });

  it.each([
    ["breakfast", "早餐"],
    ["dinner", "晚餐"],
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

  it("merges multiple same-type records on a day into a single meal", async () => {
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
        recordedAt: "2026-07-01 15:00",
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

  it("skips a meal type that already existed before the import (judged from a pre-import snapshot)", async () => {
    mealRepository.seed("user-1", "2026-07-01", "點心");
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
        recordedAt: "2026-07-01 15:00",
        items: [{ name: "餅乾", staple: 1, meat: 0, fruit: 0, veg: 0 }],
      },
    ];

    const summary = await importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT);

    // Skipped once for the meal type, not once per record.
    expect(summary).toEqual({ mealsImported: 0, mealsSkipped: 1, glucoseImported: 0, from: "2026-07-01", to: "2026-07-01" });
    const meals = await mealRepository.listMealsByDay("user-1", "2026-07-01");
    expect(meals).toHaveLength(1);
    expect(meals[0].items).toHaveLength(0);
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

  it("propagates a chaodays sign-in auth failure", async () => {
    chaodaysClient.signInError = new ChaodaysAuthError();

    await expect(
      importChaodaysDiet(mealRepository, vitalsRepository, chaodaysClient, BASE_INPUT),
    ).rejects.toThrow(ChaodaysAuthError);
  });
});
