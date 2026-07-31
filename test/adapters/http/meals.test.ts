import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { DailyTarget } from "../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../../../src/contexts/health/domain/daily-target-repository";
import { portionsToNutrients } from "../../../src/contexts/health/domain/conversion";
import type {
  CreateCustomFoodItemInput,
  CreateSharedFoodItemInput,
  FoodDictionaryRepository,
  UpdateSharedFoodItemPatch,
} from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { FoodItem } from "../../../src/contexts/health/domain/food-item";
import type { MealEntry, MealItem, MealSummary } from "../../../src/contexts/health/domain/meal-entry";
import type {
  CreateMealItemInput,
  MealRepository,
  UpdateMealItemPatch,
  UpsertMealWithItemsInput,
} from "../../../src/contexts/health/domain/meal-repository";
import { measureToQuantity } from "../../../src/contexts/health/domain/quantity";
import type { WaterIntake, WaterTarget } from "../../../src/contexts/health/domain/water";
import type { SetWaterTargetInput, WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";

const PROJECT_ID = "life-os-test";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KEY_ID = "test-key-1";

let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;

async function validToken(uid = "uid-1"): Promise<string> {
  return new SignJWT({ email: "alice@example.com", name: "Alice" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setSubject(uid)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(PROJECT_ID)
    .setExpirationTime("1h")
    .sign(signingKey);
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  signingKey = privateKey;
  const jwk = await exportJWK(publicKey);
  jwk.kid = KEY_ID;
  jwk.alg = "RS256";
  jwk.use = "sig";
  const keySet: JSONWebKeySet = { keys: [jwk] };
  jwks = createLocalJWKSet(keySet);
});

class InMemoryUserRepository implements UserRepository {
  private usersByFirebaseUid = new Map<string, User>();
  private nextId = 1;

  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const existing = this.usersByFirebaseUid.get(input.firebaseUid);
    if (existing) return existing;
    const user: User = {
      id: `user-${this.nextId++}`,
      firebaseUid: input.firebaseUid,
      email: input.email,
      displayName: input.displayName,
      timezone: "Asia/Taipei",
      isAdmin: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    this.usersByFirebaseUid.set(input.firebaseUid, user);
    return user;
  }

  async updateTimezone(userId: string, timezone: string): Promise<void> {
    for (const user of this.usersByFirebaseUid.values()) {
      if (user.id === userId) {
        user.timezone = timezone;
        return;
      }
    }
  }

  async getById(userId: string): Promise<User | null> {
    for (const user of this.usersByFirebaseUid.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }
}

class InMemoryFoodDictionaryRepository implements FoodDictionaryRepository {
  items: FoodItem[] = [];
  private nextId = 1;

  seed(item: Omit<FoodItem, "id" | "createdAt">): FoodItem {
    const created: FoodItem = { id: `item-${this.nextId++}`, createdAt: new Date(), ...item };
    this.items.push(created);
    return created;
  }

  async search(userId: string, query: string): Promise<FoodItem[]> {
    const needle = query.toLowerCase();
    return this.items.filter(
      (item) => (item.ownerUserId === null || item.ownerUserId === userId) && item.name.toLowerCase().includes(needle),
    );
  }

  async findById(userId: string, id: string): Promise<FoodItem | null> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    return item.ownerUserId === null || item.ownerUserId === userId ? item : null;
  }

  async createCustom(input: CreateCustomFoodItemInput): Promise<FoodItem> {
    return this.seed({ ...input, baseAmount: null, measureUnit: null });
  }

  async favorite(): Promise<void> {}
  async unfavorite(): Promise<void> {}
  async listFavorites(): Promise<FoodItem[]> {
    return [];
  }

  async findSharedById(id: string): Promise<FoodItem | null> {
    const item = this.items.find((i) => i.id === id);
    return item && item.ownerUserId === null ? item : null;
  }

  async createShared(input: CreateSharedFoodItemInput): Promise<FoodItem> {
    return this.seed({ ...input, ownerUserId: null });
  }

  async updateSharedById(_id: string, _patch: UpdateSharedFoodItemPatch): Promise<FoodItem | null> {
    return null;
  }
}

type StoredMeal = MealSummary & { items: MealItem[] };

class InMemoryMealRepository implements MealRepository {
  meals: StoredMeal[] = [];
  private nextMealId = 1;
  private nextItemId = 1;

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

  private toStoredItem(mealEntryId: string, item: CreateMealItemInput): MealItem {
    return { id: `item-${this.nextItemId++}`, mealEntryId, createdAt: new Date(), ...item };
  }

  async listMealsByDay(userId: string, day: string): Promise<MealEntry[]> {
    return this.meals.filter((m) => m.userId === userId && m.day === day);
  }

  async listMealsInRange(): Promise<MealEntry[]> {
    throw new Error("not used in this test");
  }

  async createMeals(): Promise<void> {
    throw new Error("not used in this test");
  }

  async listLoggedDays(userId: string, month: string): Promise<string[]> {
    const days = new Set(this.meals.filter((m) => m.userId === userId && m.day.startsWith(month)).map((m) => m.day));
    return [...days].sort();
  }

  async updateMealTime(userId: string, mealId: string, time: Date): Promise<MealSummary | null> {
    const meal = this.meals.find((m) => m.userId === userId && m.id === mealId);
    if (!meal) return null;
    meal.time = time;
    return meal;
  }

  async deleteMeal(userId: string, mealId: string): Promise<boolean> {
    const idx = this.meals.findIndex((m) => m.userId === userId && m.id === mealId);
    if (idx === -1) return false;
    this.meals.splice(idx, 1);
    return true;
  }

  async updateItem(userId: string, itemId: string, patch: UpdateMealItemPatch): Promise<MealItem | null> {
    const meal = this.meals.find((m) => m.userId === userId && m.items.some((i) => i.id === itemId));
    if (!meal) return null;
    const item = meal.items.find((i) => i.id === itemId);
    if (!item) return null;

    if (patch.quantity !== undefined) {
      item.quantity = patch.quantity;
    } else if (patch.measure !== undefined) {
      item.quantity = measureToQuantity(patch.measure, item.baseAmount);
    }
    if (patch.portions !== undefined) {
      const nutrients = portionsToNutrients(patch.portions);
      item.unclassified = false;
      Object.assign(item, nutrients, patch.portions);
    }
    return item;
  }

  async deleteItem(userId: string, itemId: string): Promise<boolean> {
    const meal = this.meals.find((m) => m.userId === userId && m.items.some((i) => i.id === itemId));
    if (!meal) return false;
    const idx = meal.items.findIndex((i) => i.id === itemId);
    meal.items.splice(idx, 1);
    return true;
  }
}

class InMemoryDailyTargetRepository implements DailyTargetRepository {
  private targetsByUserDay = new Map<string, DailyTarget>();
  private nextId = 1;

  async get(userId: string, day: string): Promise<DailyTarget | null> {
    return this.targetsByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async listInRange(): Promise<DailyTarget[]> {
    throw new Error("not used in this test");
  }

  async getLatestOnOrBefore(userId: string, day: string): Promise<DailyTarget | null> {
    let latest: DailyTarget | null = null;
    for (const target of this.targetsByUserDay.values()) {
      if (target.userId === userId && target.day <= day && (!latest || target.day > latest.day)) {
        latest = target;
      }
    }
    return latest;
  }

  async set(input: SetDailyTargetInput): Promise<DailyTarget> {
    const target: DailyTarget = {
      id: `target-${this.nextId++}`,
      userId: input.userId,
      day: input.day,
      baseStaple: input.baseStaple,
      baseMeat: input.baseMeat,
      baseFruit: input.baseFruit,
      baseVeg: input.baseVeg,
      bonusStaple: input.bonusStaple ?? 0,
      bonusMeat: input.bonusMeat ?? 0,
      bonusFruit: input.bonusFruit ?? 0,
      bonusVeg: input.bonusVeg ?? 0,
    };
    this.targetsByUserDay.set(`${input.userId}:${input.day}`, target);
    return target;
  }

  async setMany(rows: SetDailyTargetInput[]): Promise<void> {
    for (const row of rows) await this.set(row);
  }
}

class InMemoryWaterRepository implements WaterRepository {
  private intakeByUserDay = new Map<string, WaterIntake>();
  private targetByUserDay = new Map<string, WaterTarget>();

  async getIntake(userId: string, day: string): Promise<WaterIntake | null> {
    return this.intakeByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async addIntake(userId: string, day: string, addMl: number): Promise<WaterIntake> {
    const current = this.intakeByUserDay.get(`${userId}:${day}`);
    const totalMl = Math.max(0, (current?.totalMl ?? 0) + addMl);
    const intake: WaterIntake = { userId, day, totalMl };
    this.intakeByUserDay.set(`${userId}:${day}`, intake);
    return intake;
  }

  async addIntakeMany(rows: { userId: string; day: string; addMl: number }[]): Promise<void> {
    for (const row of rows) {
      await this.addIntake(row.userId, row.day, row.addMl);
    }
  }

  async listIntakeRange(userId: string, from: string, to: string): Promise<WaterIntake[]> {
    return [...this.intakeByUserDay.values()].filter((r) => r.userId === userId && r.day >= from && r.day <= to);
  }

  async getTarget(userId: string, day: string): Promise<WaterTarget | null> {
    return this.targetByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async getLatestTargetOnOrBefore(userId: string, day: string): Promise<WaterTarget | null> {
    let latest: WaterTarget | null = null;
    for (const target of this.targetByUserDay.values()) {
      if (target.userId === userId && target.day <= day && (!latest || target.day > latest.day)) {
        latest = target;
      }
    }
    return latest;
  }

  async listTargetRange(userId: string, from: string, to: string): Promise<WaterTarget[]> {
    return [...this.targetByUserDay.values()].filter((t) => t.userId === userId && t.day >= from && t.day <= to);
  }

  async setTarget(input: SetWaterTargetInput): Promise<WaterTarget> {
    const target: WaterTarget = { userId: input.userId, day: input.day, targetMl: input.targetMl };
    this.targetByUserDay.set(`${input.userId}:${input.day}`, target);
    return target;
  }

  async setTargetMany(rows: SetWaterTargetInput[]): Promise<void> {
    for (const row of rows) await this.setTarget(row);
  }
}

const stubBowelRepository: BowelRepository = {
  get: () => {
    throw new Error("not implemented in this test's fakes");
  },
  set: () => {
    throw new Error("not implemented in this test's fakes");
  },
  setMany: () => {
    throw new Error("not implemented in this test's fakes");
  },
  listRange: () => {
    throw new Error("not implemented in this test's fakes");
  },
};
const stubVitalsRepository: VitalsRepository = {
  get: () => {
    throw new Error("not implemented in this test's fakes");
  },
  set: () => {
    throw new Error("not implemented in this test's fakes");
  },
  setMany: () => {
    throw new Error("not implemented in this test's fakes");
  },
  getLatestWeight: () => {
    throw new Error("not implemented in this test's fakes");
  },
  getEarliestWeight: () => {
    throw new Error("not implemented in this test's fakes");
  },
  getWeightDayCount: () => {
    throw new Error("not implemented in this test's fakes");
  },
  listRange: () => {
    throw new Error("not implemented in this test's fakes");
  },
};
const stubBodyProfileRepository: BodyProfileRepository = {
  get: () => {
    throw new Error("not implemented in this test's fakes");
  },
  upsert: () => {
    throw new Error("not implemented in this test's fakes");
  },
};
const stubChaodaysClient: ChaodaysClient = {
  signIn: () => {
    throw new Error("not implemented in this test's fakes");
  },
  fetchWeightRecords: () => {
    throw new Error("not implemented in this test's fakes");
  },
  fetchDietRecords: () => {
    throw new Error("not implemented in this test's fakes");
  },
  fetchWaterRecords: () => {
    throw new Error("not implemented in this test's fakes");
  },
  fetchDefecationRecords: () => {
    throw new Error("not implemented in this test's fakes");
  },
  fetchDietMenus: () => {
    throw new Error("not implemented in this test's fakes");
  },
  fetchMenstruals: () => {
    throw new Error("not implemented in this test's fakes");
  },
};
const stubExerciseRepository: ExerciseRepository = {
  addEntry: () => {
    throw new Error("not implemented in this test's fakes");
  },
  listByDay: () => {
    throw new Error("not implemented in this test's fakes");
  },
  deleteEntry: () => {
    throw new Error("not implemented in this test's fakes");
  },
};
const stubMenstrualRepository: MenstrualRepository = {
  add: () => {
    throw new Error("not implemented in this test's fakes");
  },
  listByUser: () => {
    throw new Error("not implemented in this test's fakes");
  },
  update: () => {
    throw new Error("not implemented in this test's fakes");
  },
  delete: () => {
    throw new Error("not implemented in this test's fakes");
  },
};

function buildApp() {
  const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
  const mealRepository = new InMemoryMealRepository();
  const dailyTargetRepository = new InMemoryDailyTargetRepository();
  const waterRepository = new InMemoryWaterRepository();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(),
    foodDictionaryRepository,
    mealRepository,
    dailyTargetRepository,
    waterRepository,
    bowelRepository: stubBowelRepository,
    vitalsRepository: stubVitalsRepository,
    exerciseRepository: stubExerciseRepository,
    menstrualRepository: stubMenstrualRepository,
    bodyProfileRepository: stubBodyProfileRepository,
    healthCalendarRepository: { listLoggedDays: async () => [] },
    chaodaysClient: stubChaodaysClient,
    pushSubscriptionRepository: {
      upsert: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listByUser: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      deleteByEndpoint: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    pushSender: {
      send: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    careItemRepository: {
      create: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listByUser: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      get: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      getByScheduleId: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      update: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      delete: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listActiveSchedules: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listActiveSchedulesForUserOn: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      decrementStock: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      incrementStock: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    careLogRepository: {
      upsertIfAbsent: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      getBySlot: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listByUserAndDate: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listByUserAndDateRange: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      upsert: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    financeCategoryRepository: {
      listByUser: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      findById: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      findByUserTypeName: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      create: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      update: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      insertDefaultsIfMissing: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    financeTransactionRepository: {
      create: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      findById: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listByUserAndRange: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      update: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      delete: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      getMonthlySummaryRaw: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    financeBudgetRepository: {
      upsert: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      findByUserAndCategory: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      delete: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listWithSpent: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      getSpent: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      tryRecordAlert: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    financeNetWorthRepository: {
      listAccounts: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      findAccountById: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      findAccountByUserKindName: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      createAccount: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      updateAccount: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      insertDefaultAccountsIfMissing: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      upsertSnapshot: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listMonthValues: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      getMonthlyTotals: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      findPreviousSnapshotMonth: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      getTrend: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    budgetAlertNotifier: {
      notify: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    vapidPublicKey: "",
    ping: async () => {},
  });
  return { app, foodDictionaryRepository, mealRepository, dailyTargetRepository };
}

const riceBowl = {
  ownerUserId: null,
  name: "飯/1碗",
  carbG: 60,
  proteinG: 0,
  fatG: 0,
  sugarG: 0,
  fiberG: 0,
  kcal: 240,
  staple: 4,
  meat: 0,
  fruit: 0,
  veg: 0,
  baseAmount: null,
  measureUnit: null,
} as const;

const riceGram = {
  ownerUserId: null,
  name: "飯/50g",
  carbG: 15,
  proteinG: 0,
  fatG: 0,
  sugarG: 0,
  fiberG: 0,
  kcal: 60,
  staple: 1,
  meat: 0,
  fruit: 0,
  veg: 0,
  baseAmount: 50,
  measureUnit: "g",
} as const;

const soyMilk = {
  ownerUserId: null,
  name: "無糖豆漿/240mL",
  carbG: 0,
  proteinG: 7,
  fatG: 0,
  sugarG: 0,
  fiberG: 0,
  kcal: 28,
  staple: 0,
  meat: 1,
  fruit: 0,
  veg: 0,
  baseAmount: 240,
  measureUnit: "ml",
} as const;

const cherries = {
  ownerUserId: null,
  name: "櫻桃/9顆",
  carbG: 30,
  proteinG: 0,
  fatG: 0,
  sugarG: 30,
  fiberG: 0,
  kcal: 120,
  staple: 0,
  meat: 0,
  fruit: 2,
  veg: 0,
  baseAmount: 9,
  measureUnit: "顆",
} as const;

describe("meal HTTP routes", () => {
  it("requires auth for POST /api/meals", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
    });

    expect(res.status).toBe(401);
  });

  it("requires auth for GET /api/meals", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/meals?day=2026-07-18");

    expect(res.status).toBe(401);
  });

  it("creates a meal with several items in one call", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const banana = foodDictionaryRepository.seed(riceBowl);
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        day: "2026-07-18",
        meal: "lunch",
        time: "2026-07-18T12:00:00.000Z",
        items: [
          { food_item_id: banana.id },
          { portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } },
          { nutrients: { carb_g: 5, protein_g: 0, fat_g: 0, sugar_g: 0, fiber_g: 0, kcal: 20 } },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { meal: string; items: unknown[] };
    expect(body.meal).toBe("lunch");
    expect(body.items).toHaveLength(3);
  });

  it("appending to an existing meal reuses it (no duplicate meal)", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const banana = foodDictionaryRepository.seed(riceBowl);
    const token = await validToken();

    await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: banana.id }] }),
    });
    await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: banana.id }] }),
    });

    const res = await app.request("/api/meals?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { meals: { meal: string; items: unknown[] }[] };

    expect(body.meals).toHaveLength(1);
    expect(body.meals[0]?.items).toHaveLength(2);
  });

  it("stores a dictionary item's per-unit values with quantity (1.5x -> per-unit 4 staple, consumed 6 staple)", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const item = foodDictionaryRepository.seed(riceBowl);
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id, quantity: 1.5 }] }),
    });

    const body = (await res.json()) as {
      items: { staple: number; quantity: number; base_amount: number | null; measure_unit: string | null; consumed: { staple: number } }[];
    };
    expect(body.items[0]?.staple).toBe(4);
    expect(body.items[0]?.quantity).toBe(1.5);
    expect(body.items[0]?.consumed.staple).toBe(6);
    expect(body.items[0]?.base_amount).toBeNull();
    expect(body.items[0]?.measure_unit).toBeNull();
  });

  it("converts a gram-based dictionary item to a quantity via base_amount", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const item = foodDictionaryRepository.seed(riceGram);
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id, measure: 33 }] }),
    });

    const body = (await res.json()) as { items: { quantity: number; base_amount: number | null; measure_unit: string | null }[] };
    expect(body.items[0]?.quantity).toBeCloseTo(0.66);
    expect(body.items[0]?.base_amount).toBe(50);
    expect(body.items[0]?.measure_unit).toBe("g");
  });

  it("converts a millilitre-based dictionary item to a quantity via base_amount", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const item = foodDictionaryRepository.seed(soyMilk);
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id, measure: 120 }] }),
    });

    const body = (await res.json()) as { items: { quantity: number; base_amount: number | null; measure_unit: string | null }[] };
    expect(body.items[0]?.quantity).toBe(0.5);
    expect(body.items[0]?.base_amount).toBe(240);
    expect(body.items[0]?.measure_unit).toBe("ml");
  });

  it("converts a household-quantifier dictionary item to a quantity via base_amount (no longer a blanket 400)", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const item = foodDictionaryRepository.seed(cherries);
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id, measure: 18 }] }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { items: { quantity: number; base_amount: number | null; measure_unit: string | null }[] };
    expect(body.items[0]?.quantity).toBe(2);
    expect(body.items[0]?.base_amount).toBe(9);
    expect(body.items[0]?.measure_unit).toBe("顆");
  });

  it("rejects a measure-based item when the dictionary item has no base_amount, as 400", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const item = foodDictionaryRepository.seed(riceBowl);
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id, measure: 33 }] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects an item supplying both measure and quantity, as 400", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const item = foodDictionaryRepository.seed(riceGram);
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id, measure: 33, quantity: 1.5 }] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a meal with no items, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a meal with a missing day, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects an invalid calendar day, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-02-30", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
    });

    expect(res.status).toBe(400);
  });

  it("orders a day's meals by time and returns totals", async () => {
    const { app } = buildApp();
    const token = await validToken();

    await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        day: "2026-07-18",
        meal: "dinner",
        time: "2026-07-18T19:00:00.000Z",
        items: [{ portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }],
      }),
    });
    await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        day: "2026-07-18",
        meal: "breakfast",
        time: "2026-07-18T08:00:00.000Z",
        items: [{ portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }],
      }),
    });

    const res = await app.request("/api/meals?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { meals: { meal: string }[]; totals: { staple: number } };
    expect(body.meals.map((m) => m.meal)).toEqual(["breakfast", "dinner"]);
    expect(body.totals.staple).toBe(2);
  });

  it("rejects a day view request without a day, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/meals", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  describe("GET /api/meals/logged-days", () => {
    it("requires auth", async () => {
      const { app } = buildApp();

      const res = await app.request("/api/meals/logged-days?month=2026-07");

      expect(res.status).toBe(401);
    });

    it("returns the distinct logged days in the requested month, ascending", async () => {
      const { app } = buildApp();
      const token = await validToken();
      await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-04", meal: "breakfast", items: [{ portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }] }),
      });
      await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-01", meal: "breakfast", items: [{ portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }] }),
      });

      const res = await app.request("/api/meals/logged-days?month=2026-07", { headers: { Authorization: `Bearer ${token}` } });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { days: string[] };
      expect(body).toEqual({ days: ["2026-07-01", "2026-07-04"] });
    });

    it("rejects a malformed month, as 400", async () => {
      const { app } = buildApp();
      const token = await validToken();

      const res = await app.request("/api/meals/logged-days?month=2026-13", { headers: { Authorization: `Bearer ${token}` } });

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/meals/:id", () => {
    it("requires auth", async () => {
      const { app } = buildApp();

      const res = await app.request("/api/meals/meal-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: "2026-07-18T20:00:00.000Z" }),
      });

      expect(res.status).toBe(401);
    });

    it("updates the meal's time without moving its day", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          day: "2026-07-18",
          meal: "dinner",
          time: "2026-07-18T23:00:00.000Z",
          items: [{ portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }],
        }),
      });
      const { id } = (await created.json()) as { id: string };

      const res = await app.request(`/api/meals/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ time: "2026-07-19T01:00:00.000Z" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { day: string; time: string };
      expect(body.day).toBe("2026-07-18");
      expect(body.time).toBe("2026-07-19T01:00:00.000Z");
    });

    it("rejects a missing time, as 400", async () => {
      const { app } = buildApp();
      const token = await validToken();

      const res = await app.request("/api/meals/meal-1", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 for another user's meal", async () => {
      const { app } = buildApp();
      const token = await validToken("uid-1");
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
      });
      const { id } = (await created.json()) as { id: string };
      const otherToken = await validToken("uid-2");

      const res = await app.request(`/api/meals/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ time: "2026-07-19T01:00:00.000Z" }),
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });

  describe("DELETE /api/meals/:id", () => {
    it("requires auth", async () => {
      const { app } = buildApp();

      const res = await app.request("/api/meals/meal-1", { method: "DELETE" });

      expect(res.status).toBe(401);
    });

    it("deletes the meal and (cascade) its items", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
      });
      const { id } = (await created.json()) as { id: string };

      const res = await app.request(`/api/meals/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });

      expect(res.status).toBe(204);
      const dayRes = await app.request("/api/meals?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });
      const body = (await dayRes.json()) as { meals: unknown[] };
      expect(body.meals).toEqual([]);
    });

    it("returns 404 for another user's meal", async () => {
      const { app } = buildApp();
      const token = await validToken("uid-1");
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
      });
      const { id } = (await created.json()) as { id: string };
      const otherToken = await validToken("uid-2");

      const res = await app.request(`/api/meals/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${otherToken}` } });

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/meal-items/:id", () => {
    it("requires auth", async () => {
      const { app } = buildApp();

      const res = await app.request("/api/meal-items/item-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: 2 }),
      });

      expect(res.status).toBe(401);
    });

    it("a quantity update leaves per-unit values unchanged (no double-scale)", async () => {
      const { app, foodDictionaryRepository } = buildApp();
      const item = foodDictionaryRepository.seed(riceGram);
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id }] }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: 2 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { quantity: number; staple: number; consumed: { staple: number } };
      expect(body.quantity).toBe(2);
      expect(body.staple).toBe(1);
      expect(body.consumed.staple).toBe(2);
    });

    it("a measure update sets quantity = measure / base_amount", async () => {
      const { app, foodDictionaryRepository } = buildApp();
      const item = foodDictionaryRepository.seed(riceGram);
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id }] }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ measure: 33 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { quantity: number; base_amount: number | null; measure_unit: string | null };
      expect(body.quantity).toBeCloseTo(0.66);
      expect(body.base_amount).toBe(50);
      expect(body.measure_unit).toBe("g");
    });

    it("rejects a measure update when the item has no base_amount, as 400", async () => {
      const { app, foodDictionaryRepository } = buildApp();
      const item = foodDictionaryRepository.seed(riceBowl);
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id }] }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ measure: 33 }),
      });

      expect(res.status).toBe(400);
    });

    it("a portions update recomputes per-unit nutrients and clears unclassified", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          day: "2026-07-18",
          meal: "snack",
          items: [{ nutrients: { carb_g: 5, protein_g: 0, fat_g: 0, sugar_g: 0, fiber_g: 0, kcal: 20 } }],
        }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ portions: { staple: 2 } }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { staple: number; carb_g: number; unclassified: boolean };
      expect(body.staple).toBe(2);
      expect(body.carb_g).toBe(30);
      expect(body.unclassified).toBe(false);
    });

    it("rejects an empty patch, as 400", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("rejects supplying both quantity and measure, as 400", async () => {
      const { app, foodDictionaryRepository } = buildApp();
      const item = foodDictionaryRepository.seed(riceGram);
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ food_item_id: item.id }] }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: 2, measure: 100 }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 for another user's item", async () => {
      const { app } = buildApp();
      const token = await validToken("uid-1");
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };
      const otherToken = await validToken("uid-2");

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: 2 }),
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });

  describe("DELETE /api/meal-items/:id", () => {
    it("requires auth", async () => {
      const { app } = buildApp();

      const res = await app.request("/api/meal-items/item-1", { method: "DELETE" });

      expect(res.status).toBe(401);
    });

    it("removes the item from its meal", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(204);
      const dayRes = await app.request("/api/meals?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });
      const body = (await dayRes.json()) as { meals: { items: unknown[] }[] };
      expect(body.meals[0]?.items).toEqual([]);
    });

    it("returns 404 for another user's item", async () => {
      const { app } = buildApp();
      const token = await validToken("uid-1");
      const created = await app.request("/api/meals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 1 } }] }),
      });
      const { items } = (await created.json()) as { items: { id: string }[] };
      const otherToken = await validToken("uid-2");

      const res = await app.request(`/api/meal-items/${items[0]!.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${otherToken}` },
      });

      expect(res.status).toBe(404);
    });
  });

  it("reflects logged meal items in the daily target's remaining view", async () => {
    const { app } = buildApp();
    const token = await validToken();

    await app.request("/api/daily-target", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", base_staple: 12, base_meat: 7, base_fruit: 2, base_veg: 2 }),
    });
    await app.request("/api/meals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", items: [{ portions: { staple: 9, meat: 0, fruit: 0, veg: 0 } }] }),
    });

    const res = await app.request("/api/daily-target?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { remaining: { staple: number } };
    expect(body.remaining.staple).toBe(3);
  });
});
