import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type {
  CreateCustomFoodItemInput,
  CreateSharedFoodItemInput,
  FoodDictionaryRepository,
  UpdateSharedFoodItemPatch,
} from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { FoodItem } from "../../../src/contexts/health/domain/food-item";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}
const stubChaodaysClient: ChaodaysClient = {
  signIn: notImplemented,
  fetchWeightRecords: notImplemented,
  fetchDietRecords: notImplemented,
  fetchWaterRecords: notImplemented,
  fetchDefecationRecords: notImplemented,
  fetchDietMenus: notImplemented,
  fetchMenstruals: notImplemented,
};
const stubMealRepository: MealRepository = {
  upsertMealWithItems: notImplemented,
  createMeals: notImplemented,
  listMealsByDay: notImplemented,
  listMealsInRange: notImplemented,
  listLoggedDays: notImplemented,
  updateMealTime: notImplemented,
  deleteMeal: notImplemented,
  updateItem: notImplemented,
  deleteItem: notImplemented,
};
const stubDailyTargetRepository: DailyTargetRepository = {
  get: notImplemented,
  getLatestOnOrBefore: notImplemented,
  listInRange: notImplemented,
  set: notImplemented,
  setMany: notImplemented,
};
const stubBowelRepository: BowelRepository = {
  get: notImplemented,
  set: notImplemented,
  setMany: notImplemented,
  listRange: notImplemented,
};
const stubVitalsRepository: VitalsRepository = {
  get: notImplemented,
  set: notImplemented,
  setMany: notImplemented,
  getLatestWeight: notImplemented,
  getEarliestWeight: notImplemented,
  getWeightDayCount: notImplemented,
  listRange: notImplemented,
};
const stubExerciseRepository: ExerciseRepository = {
  addEntry: notImplemented,
  listByDay: notImplemented,
  deleteEntry: notImplemented,
};
const stubMenstrualRepository: MenstrualRepository = {
  add: notImplemented,
  listByUser: notImplemented,
  update: notImplemented,
  delete: notImplemented,
};
const stubBodyProfileRepository: BodyProfileRepository = {
  get: notImplemented,
  upsert: notImplemented,
};
const stubWaterRepository: WaterRepository = {
  getIntake: notImplemented,
  addIntake: notImplemented,
  addIntakeMany: notImplemented,
  listIntakeRange: notImplemented,
  getTarget: notImplemented,
  getLatestTargetOnOrBefore: notImplemented,
  listTargetRange: notImplemented,
  setTarget: notImplemented,
  setTargetMany: notImplemented,
};

const PROJECT_ID = "life-os-test";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KEY_ID = "test-key-1";

let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;

async function tokenFor(uid: string): Promise<string> {
  return new SignJWT({ email: `${uid}@example.com`, name: uid })
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

/** Get-or-create user repository whose isAdmin flag is decided by membership in `adminUids`. */
class InMemoryUserRepository implements UserRepository {
  private usersByFirebaseUid = new Map<string, User>();
  private nextId = 1;

  constructor(private readonly adminUids: Set<string> = new Set()) {}

  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const existing = this.usersByFirebaseUid.get(input.firebaseUid);
    if (existing) return existing;
    const user: User = {
      id: `user-${this.nextId++}`,
      firebaseUid: input.firebaseUid,
      email: input.email,
      displayName: input.displayName,
      timezone: "Asia/Taipei",
      isAdmin: this.adminUids.has(input.firebaseUid),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    this.usersByFirebaseUid.set(input.firebaseUid, user);
    return user;
  }

  async updateTimezone(): Promise<void> {}

  async getById(userId: string): Promise<User | null> {
    for (const user of this.usersByFirebaseUid.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }
}

/** Real (non-throwing) in-memory FoodDictionaryRepository, mirroring the drizzle adapter's shared-only scoping. */
class InMemoryFoodDictionaryRepository implements FoodDictionaryRepository {
  items = new Map<string, FoodItem>();
  private nextId = 1;
  /** Records the raw argument each call received, so a test can assert on exactly what crossed the port boundary (e.g. that no `seedKey` property leaked through). */
  lastCreateSharedInput: CreateSharedFoodItemInput | null = null;
  lastUpdateSharedPatch: UpdateSharedFoodItemPatch | null = null;

  seed(item: Omit<FoodItem, "id" | "createdAt"> & { id?: string }): FoodItem {
    const id = item.id ?? `00000000-0000-0000-0000-${String(this.nextId++).padStart(12, "0")}`;
    const created: FoodItem = { id, createdAt: new Date(), ...item };
    this.items.set(created.id, created);
    return created;
  }

  async search(userId: string, query: string): Promise<FoodItem[]> {
    const needle = query.toLowerCase();
    return [...this.items.values()].filter(
      (item) => (item.ownerUserId === null || item.ownerUserId === userId) && item.name.toLowerCase().includes(needle),
    );
  }

  async findById(userId: string, id: string): Promise<FoodItem | null> {
    const item = this.items.get(id);
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
    const item = this.items.get(id);
    return item && item.ownerUserId === null ? item : null;
  }

  async createShared(input: CreateSharedFoodItemInput): Promise<FoodItem> {
    this.lastCreateSharedInput = input;
    return this.seed({ ...input, ownerUserId: null });
  }

  async updateSharedById(id: string, patch: UpdateSharedFoodItemPatch): Promise<FoodItem | null> {
    this.lastUpdateSharedPatch = patch;
    const item = this.items.get(id);
    if (!item || item.ownerUserId !== null) return null;
    const updated: FoodItem = { ...item };
    if ("name" in patch && patch.name !== undefined) updated.name = patch.name;
    if ("carbG" in patch && patch.carbG !== undefined) updated.carbG = patch.carbG;
    if ("proteinG" in patch && patch.proteinG !== undefined) updated.proteinG = patch.proteinG;
    if ("fatG" in patch && patch.fatG !== undefined) updated.fatG = patch.fatG;
    if ("sugarG" in patch && patch.sugarG !== undefined) updated.sugarG = patch.sugarG;
    if ("fiberG" in patch && patch.fiberG !== undefined) updated.fiberG = patch.fiberG;
    if ("kcal" in patch && patch.kcal !== undefined) updated.kcal = patch.kcal;
    if ("staple" in patch && patch.staple !== undefined) updated.staple = patch.staple;
    if ("meat" in patch && patch.meat !== undefined) updated.meat = patch.meat;
    if ("fruit" in patch && patch.fruit !== undefined) updated.fruit = patch.fruit;
    if ("veg" in patch && patch.veg !== undefined) updated.veg = patch.veg;
    if ("baseAmount" in patch) updated.baseAmount = patch.baseAmount ?? null;
    if ("measureUnit" in patch) updated.measureUnit = patch.measureUnit ?? null;
    this.items.set(id, updated);
    return updated;
  }
}

function buildApp(options: { userRepository: UserRepository; foodDictionaryRepository: FoodDictionaryRepository }) {
  return createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: options.userRepository,
    foodDictionaryRepository: options.foodDictionaryRepository,
    mealRepository: stubMealRepository,
    dailyTargetRepository: stubDailyTargetRepository,
    waterRepository: stubWaterRepository,
    bowelRepository: stubBowelRepository,
    vitalsRepository: stubVitalsRepository,
    exerciseRepository: stubExerciseRepository,
    menstrualRepository: stubMenstrualRepository,
    bodyProfileRepository: stubBodyProfileRepository,
    healthCalendarRepository: { listLoggedDays: async () => [] },
    chaodaysClient: stubChaodaysClient,
    pushSubscriptionRepository: {
      upsert: notImplemented,
      listByUser: notImplemented,
      deleteByEndpoint: notImplemented,
    },
    pushSender: { send: notImplemented },
    careItemRepository: {
      create: notImplemented,
      listByUser: notImplemented,
      get: notImplemented,
      getByScheduleId: notImplemented,
      update: notImplemented,
      delete: notImplemented,
      listActiveSchedules: notImplemented,
      listActiveSchedulesForUserOn: notImplemented,
      decrementStock: notImplemented,
      incrementStock: notImplemented,
    },
    careLogRepository: {
      upsertIfAbsent: notImplemented,
      getBySlot: notImplemented,
      listByUserAndDate: notImplemented,
      listByUserAndDateRange: notImplemented,
      upsert: notImplemented,
    },
    vapidPublicKey: "",
    financeCategoryRepository: {
      listByUser: notImplemented,
      findById: notImplemented,
      findByUserTypeName: notImplemented,
      create: notImplemented,
      update: notImplemented,
      insertDefaultsIfMissing: notImplemented,
    },
    financeTransactionRepository: {
      create: notImplemented,
      findById: notImplemented,
      listByUserAndRange: notImplemented,
      update: notImplemented,
      delete: notImplemented,
      getMonthlySummaryRaw: notImplemented,
    },
    financeBudgetRepository: {
      upsert: notImplemented,
      findByUserAndCategory: notImplemented,
      delete: notImplemented,
      listWithSpent: notImplemented,
      getSpent: notImplemented,
      tryRecordAlert: notImplemented,
    },
    budgetAlertNotifier: {
      notify: notImplemented,
    },
    ping: async () => {},
  });
}

const validSharedBody = {
  name: "白吐司/1片",
  carb_g: 15,
  protein_g: 2,
  fat_g: 1,
  sugar_g: 1,
  fiber_g: 1,
  kcal: 80,
  staple: 1,
};

describe("POST /api/admin/food-items", () => {
  it("as an administrator, creates a shared item that another user's search finds", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify(validSharedBody),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { owner_user_id: string | null; id: string };
    expect(body.owner_user_id).toBeNull();

    const searchRes = await app.request("/api/food-items?q=白吐司", {
      headers: { Authorization: `Bearer ${await tokenFor("uid-other")}` },
    });
    const results = (await searchRes.json()) as { id: string }[];
    expect(results.map((r) => r.id)).toContain(body.id);
  });

  it("as a non-administrator, refuses as 403 and creates nothing", async () => {
    const userRepository = new InMemoryUserRepository();
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor("uid-user")}`, "Content-Type": "application/json" },
      body: JSON.stringify(validSharedBody),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(foodDictionaryRepository.items.size).toBe(0);
  });

  it("rejects a measure_unit supplied without a base_amount, as 400, creating nothing", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validSharedBody, measure_unit: "片" }),
    });

    expect(res.status).toBe(400);
    expect(foodDictionaryRepository.items.size).toBe(0);
  });

  it("rejects a zero base_amount, as 400, creating nothing", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validSharedBody, base_amount: 0, measure_unit: "g" }),
    });

    expect(res.status).toBe(400);
    expect(foodDictionaryRepository.items.size).toBe(0);
  });

  it("rejects a negative base_amount, as 400, creating nothing", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validSharedBody, base_amount: -50, measure_unit: "g" }),
    });

    expect(res.status).toBe(400);
    expect(foodDictionaryRepository.items.size).toBe(0);
  });

  it("accepts a positive base_amount together with measure_unit, as 201", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validSharedBody, base_amount: 50, measure_unit: "g" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.base_amount).toBe(50);
    expect(body.measure_unit).toBe("g");
  });

  it("without an Authorization header, refuses as 401", async () => {
    const app = buildApp({
      userRepository: new InMemoryUserRepository(),
      foodDictionaryRepository: new InMemoryFoodDictionaryRepository(),
    });

    const res = await app.request("/api/admin/food-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSharedBody),
    });

    expect(res.status).toBe(401);
  });

  it("accepts a body carrying seed_key as 201, but does not pass it through to the repository or the response", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validSharedBody, seed_key: "飯/1碗" }),
    });

    expect(res.status).toBe(201);
    expect(foodDictionaryRepository.lastCreateSharedInput).not.toHaveProperty("seedKey");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("seed_key");
  });
});

describe("PATCH /api/admin/food-items/:id", () => {
  it("as an administrator, changes only the supplied fields", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "白吐司/1片",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: null,
      measureUnit: null,
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "全麥吐司/1片", carb_g: 14 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("全麥吐司/1片");
    expect(body.carb_g).toBe(14);
    expect(body.protein_g).toBe(2);
    expect(body.kcal).toBe(80);
  });

  it("rejects an empty body as 400", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "白吐司/1片",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: null,
      measureUnit: null,
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("reports a user-owned item id as 404, leaving it unchanged", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: "user-1",
      name: "私房菜/1份",
      carbG: 5,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 20,
      staple: 0,
      meat: 0,
      fruit: 0,
      veg: 1,
      baseAmount: null,
      measureUnit: null,
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "改名" }),
    });

    expect(res.status).toBe(404);
    expect(foodDictionaryRepository.items.get(item.id)?.name).toBe("私房菜/1份");
  });

  it("reports an unknown, well-formed id as 404", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "改名" }),
    });

    expect(res.status).toBe(404);
  });

  it("reports a malformed, non-UUID id as 404, not 500", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/admin/food-items/not-a-uuid", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "改名" }),
    });

    expect(res.status).toBe(404);
  });

  it("rejects clearing base_amount alone (measure_unit would remain) as 400, leaving the item unchanged", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/50g",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: 50,
      measureUnit: "g",
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ base_amount: null }),
    });

    expect(res.status).toBe(400);
    expect(foodDictionaryRepository.items.get(item.id)).toMatchObject({ baseAmount: 50, measureUnit: "g" });
  });

  it("accepts clearing base_amount and measure_unit together, as 200", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/50g",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: 50,
      measureUnit: "g",
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ base_amount: null, measure_unit: null }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.base_amount).toBeNull();
    expect(body.measure_unit).toBeNull();
  });

  it("rejects setting base_amount to 0, as 400, leaving the item unchanged", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/50g",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: 50,
      measureUnit: "g",
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ base_amount: 0 }),
    });

    expect(res.status).toBe(400);
    expect(foodDictionaryRepository.items.get(item.id)).toMatchObject({ baseAmount: 50, measureUnit: "g" });
  });

  it("rejects setting a negative base_amount, as 400, leaving the item unchanged", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/50g",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: 50,
      measureUnit: "g",
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ base_amount: -10 }),
    });

    expect(res.status).toBe(400);
    expect(foodDictionaryRepository.items.get(item.id)).toMatchObject({ baseAmount: 50, measureUnit: "g" });
  });

  it("accepts setting a positive base_amount, as 200", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/50g",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: 50,
      measureUnit: "g",
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ base_amount: 100 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.base_amount).toBe(100);
  });

  it("as a non-administrator, refuses as 403, leaving the item unchanged", async () => {
    const userRepository = new InMemoryUserRepository();
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "白吐司/1片",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: null,
      measureUnit: null,
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-user")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "改名" }),
    });

    expect(res.status).toBe(403);
    expect(foodDictionaryRepository.items.get(item.id)?.name).toBe("白吐司/1片");
  });

  it("without an Authorization header, refuses as 401", async () => {
    const app = buildApp({
      userRepository: new InMemoryUserRepository(),
      foodDictionaryRepository: new InMemoryFoodDictionaryRepository(),
    });

    const res = await app.request("/api/admin/food-items/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "改名" }),
    });

    expect(res.status).toBe(401);
  });

  it("treats seed_key alone in the body as an empty patch, rejected as 400, leaving the item unchanged", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "白吐司/1片",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: null,
      measureUnit: null,
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ seed_key: "白吐司/1片" }),
    });

    expect(res.status).toBe(400);
    expect(foodDictionaryRepository.items.get(item.id)?.name).toBe("白吐司/1片");
  });

  it("accepts a seed_key alongside a real field as 200, but does not pass seed_key through to the repository or the response", async () => {
    const userRepository = new InMemoryUserRepository(new Set(["uid-admin"]));
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    const item = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "白吐司/1片",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: null,
      measureUnit: null,
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request(`/api/admin/food-items/${item.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor("uid-admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "全麥吐司/1片", seed_key: "白吐司/1片" }),
    });

    expect(res.status).toBe(200);
    expect(foodDictionaryRepository.lastUpdateSharedPatch).not.toHaveProperty("seedKey");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("seed_key");
  });
});

describe("GET /api/food-items search response shape", () => {
  it("does not include seed_key on any returned item", async () => {
    const userRepository = new InMemoryUserRepository();
    const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
    foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "白吐司/1片",
      carbG: 15,
      proteinG: 2,
      fatG: 1,
      sugarG: 1,
      fiberG: 1,
      kcal: 80,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseAmount: null,
      measureUnit: null,
    });
    const app = buildApp({ userRepository, foodDictionaryRepository });

    const res = await app.request("/api/food-items?q=白吐司", {
      headers: { Authorization: `Bearer ${await tokenFor("uid-user")}` },
    });

    expect(res.status).toBe(200);
    const results = (await res.json()) as Record<string, unknown>[];
    expect(results.length).toBeGreaterThan(0);
    for (const item of results) expect(item).not.toHaveProperty("seed_key");
  });
});
