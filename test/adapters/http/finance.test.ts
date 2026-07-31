import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import {
  FakeBudgetAlertNotifier,
  InMemoryFinanceBudgetRepository,
  InMemoryFinanceCategoryRepository,
  InMemoryFinanceTransactionRepository,
} from "../../contexts/finance/fakes";
import { InMemoryNetWorthRepository } from "../../contexts/finance/networth-fakes";

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
const stubFoodDictionaryRepository: FoodDictionaryRepository = {
  search: notImplemented,
  findById: notImplemented,
  createCustom: notImplemented,
  favorite: notImplemented,
  unfavorite: notImplemented,
  listFavorites: notImplemented,
  findSharedById: notImplemented,
  createShared: notImplemented,
  updateSharedById: notImplemented,
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

function buildApp() {
  const financeCategoryRepository = new InMemoryFinanceCategoryRepository();
  const financeTransactionRepository = new InMemoryFinanceTransactionRepository();
  const financeBudgetRepository = new InMemoryFinanceBudgetRepository(financeTransactionRepository);
  const financeNetWorthRepository = new InMemoryNetWorthRepository();
  const budgetAlertNotifier = new FakeBudgetAlertNotifier();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(),
    foodDictionaryRepository: stubFoodDictionaryRepository,
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
    pushSender: {
      send: notImplemented,
    },
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
    financeCategoryRepository,
    financeTransactionRepository,
    financeBudgetRepository,
    financeNetWorthRepository,
    budgetAlertNotifier,
    vapidPublicKey: "",
    ping: async () => {},
  });
  return { app, financeCategoryRepository, financeTransactionRepository, financeBudgetRepository, financeNetWorthRepository, budgetAlertNotifier };
}

function authed(token: string, method = "GET", body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return init;
}

async function seedCategory(app: ReturnType<typeof buildApp>["app"], token: string, overrides: { name?: string; type?: string } = {}) {
  const res = await app.request(
    "/api/finance/categories",
    authed(token, "POST", { name: overrides.name ?? "餐飲", type: overrides.type ?? "expense" }),
  );
  return (await res.json()) as { id: string; name: string; type: string };
}

describe("finance HTTP routes", () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    ctx = buildApp();
  });

  it("requires auth for every /api/finance endpoint", async () => {
    const { app } = ctx;
    expect((await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31")).status).toBe(401);
    expect((await app.request("/api/finance/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/transactions/some-id", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/transactions/some-id", { method: "DELETE" })).status).toBe(401);
    expect((await app.request("/api/finance/categories")).status).toBe(401);
    expect((await app.request("/api/finance/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/categories/some-id", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/summary?month=2026-07")).status).toBe(401);
    expect((await app.request("/api/finance/budgets?month=2026-07")).status).toBe(401);
    expect((await app.request("/api/finance/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/budgets/some-id", { method: "DELETE" })).status).toBe(401);
  });

  describe("categories", () => {
    it("seeds the defaults idempotently on the first two GETs", async () => {
      const { app } = ctx;
      const token = await validToken();
      const first = (await (await app.request("/api/finance/categories", authed(token))).json()) as { categories: unknown[] };
      const second = (await (await app.request("/api/finance/categories", authed(token))).json()) as { categories: unknown[] };
      expect(first.categories).toHaveLength(11);
      expect(second.categories).toHaveLength(11);
    });

    it("creates a category", async () => {
      const { app } = ctx;
      const token = await validToken();
      const res = await app.request("/api/finance/categories", authed(token, "POST", { name: "副業", type: "income" }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ name: "副業", type: "income", icon: "other", sort_order: 0, archived: false });
    });

    it("rejects a duplicate name for the same user+type as 400", async () => {
      const { app } = ctx;
      const token = await validToken();
      await app.request("/api/finance/categories", authed(token, "POST", { name: "副業", type: "income" }));
      const res = await app.request("/api/finance/categories", authed(token, "POST", { name: "副業", type: "income" }));
      expect(res.status).toBe(400);
    });

    it("updates a category's archived flag", async () => {
      const { app } = ctx;
      const token = await validToken();
      const created = await seedCategory(app, token);
      const res = await app.request(`/api/finance/categories/${created.id}`, authed(token, "PUT", { archived: true }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ archived: true });
    });

    it("returns 404 for another user's category", async () => {
      const { app } = ctx;
      const owner = await validToken("uid-owner");
      const other = await validToken("uid-other");
      const created = await seedCategory(app, owner);
      const res = await app.request(`/api/finance/categories/${created.id}`, authed(other, "PUT", { archived: true }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });

  describe("transactions", () => {
    it("creates and lists a transaction, defaulting currency to TWD", async () => {
      const { app } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token);

      const created = await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 300, category_id: category.id, date: "2026-07-15" }),
      );
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as Record<string, unknown>;
      expect(createdBody).toMatchObject({ type: "expense", amount: 300, currency: "TWD", category_id: category.id, date: "2026-07-15" });
      expect(createdBody.id).toBeTruthy();

      const listRes = await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(token));
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { transactions: { id: string }[] };
      expect(listBody.transactions).toHaveLength(1);
      expect(listBody.transactions[0].id).toBe(createdBody.id);
    });

    it("rejects amount <= 0, a currency outside the whitelist, a malformed date, and a missing category_id — storing nothing", async () => {
      const { app, financeTransactionRepository } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token);

      expect(
        (await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 0, category_id: category.id, date: "2026-07-15" }))).status,
      ).toBe(400);
      expect(
        (
          await app.request(
            "/api/finance/transactions",
            authed(token, "POST", { type: "expense", amount: 100, currency: "XYZ", category_id: category.id, date: "2026-07-15" }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await app.request(
            "/api/finance/transactions",
            authed(token, "POST", { type: "expense", amount: 100, category_id: category.id, date: "not-a-date" }),
          )
        ).status,
      ).toBe(400);
      expect(
        (await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 100, date: "2026-07-15" }))).status,
      ).toBe(400);

      expect(financeTransactionRepository.transactions).toHaveLength(0);
    });

    it("rejects an expense transaction whose category_id is an income category (400) or another user's category (404)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const incomeCategory = await seedCategory(app, token, { name: "薪資", type: "income" });
      const otherToken = await validToken("uid-other");
      const otherCategory = await seedCategory(app, otherToken);

      const typeMismatch = await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 100, category_id: incomeCategory.id, date: "2026-07-15" }),
      );
      expect(typeMismatch.status).toBe(400);

      const foreignCategory = await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 100, category_id: otherCategory.id, date: "2026-07-15" }),
      );
      expect(foreignCategory.status).toBe(404);
    });

    it("PUT full-replaces a transaction and requires currency (400 when omitted)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token);
      const created = (await (
        await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }))
      ).json()) as { id: string };

      const missingCurrency = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 200, category_id: category.id, date: "2026-07-16" }),
      );
      expect(missingCurrency.status).toBe(400);

      const replaced = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 200, currency: "USD", category_id: category.id, date: "2026-07-16", note: "updated" }),
      );
      expect(replaced.status).toBe(200);
      expect(await replaced.json()).toMatchObject({ amount: 200, currency: "USD", date: "2026-07-16", note: "updated" });
    });

    it("archived category: blocks a new transaction (400), keeps history readable, allows editing amount/note but not switching onto it (400)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token, { name: "娛樂" });
      const otherCategory = await seedCategory(app, token, { name: "居住" });

      const created = (await (
        await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }))
      ).json()) as { id: string };

      const archiveRes = await app.request(`/api/finance/categories/${category.id}`, authed(token, "PUT", { archived: true }));
      expect(archiveRes.status).toBe(200);

      const blockedCreate = await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 50, category_id: category.id, date: "2026-07-16" }),
      );
      expect(blockedCreate.status).toBe(400);

      const listRes = await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(token));
      const listBody = (await listRes.json()) as { transactions: { id: string }[] };
      expect(listBody.transactions.map((t) => t.id)).toContain(created.id);

      const editSameCategory = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 150, currency: "TWD", category_id: category.id, date: "2026-07-15", note: "still editable" }),
      );
      expect(editSameCategory.status).toBe(200);
      expect(await editSameCategory.json()).toMatchObject({ amount: 150, note: "still editable" });

      const switchOntoArchived = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 150, currency: "TWD", category_id: otherCategory.id, date: "2026-07-15" }),
      );
      // switching FROM the (now-archived) category onto a live one is fine —
      // this asserts the reverse case in the same scenario: switching a
      // transaction still on the *live* otherCategory onto the archived one.
      expect(switchOntoArchived.status).toBe(200);

      const switchBackOntoArchived = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 150, currency: "TWD", category_id: category.id, date: "2026-07-15" }),
      );
      expect(switchBackOntoArchived.status).toBe(400);
    });

    it("DELETE removes an owned transaction", async () => {
      const { app } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token);
      const created = (await (
        await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }))
      ).json()) as { id: string };

      const res = await app.request(`/api/finance/transactions/${created.id}`, authed(token, "DELETE"));
      expect(res.status).toBe(200);

      const listRes = await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(token));
      expect(((await listRes.json()) as { transactions: unknown[] }).transactions).toHaveLength(0);
    });
  });

  describe("user isolation", () => {
    it("returns 404 for another user's transaction on GET-adjacent (PUT/DELETE) and leaves it unchanged", async () => {
      const { app } = ctx;
      const owner = await validToken("uid-owner");
      const other = await validToken("uid-other");
      const category = await seedCategory(app, owner);
      const created = (await (
        await app.request("/api/finance/transactions", authed(owner, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }))
      ).json()) as { id: string };

      const putRes = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(other, "PUT", { type: "expense", amount: 999, currency: "TWD", category_id: category.id, date: "2026-07-15" }),
      );
      expect(putRes.status).toBe(404);
      expect(await putRes.json()).toEqual({ error: "not_found" });

      const deleteRes = await app.request(`/api/finance/transactions/${created.id}`, authed(other, "DELETE"));
      expect(deleteRes.status).toBe(404);

      const ownerListRes = await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(owner));
      const ownerList = (await ownerListRes.json()) as { transactions: { amount: number }[] };
      expect(ownerList.transactions[0].amount).toBe(100);
    });

    it("a user's transactions list is scoped to their own data", async () => {
      const { app } = ctx;
      const userA = await validToken("uid-a");
      const userB = await validToken("uid-b");
      const categoryA = await seedCategory(app, userA);
      const categoryB = await seedCategory(app, userB);

      await app.request("/api/finance/transactions", authed(userA, "POST", { type: "expense", amount: 100, category_id: categoryA.id, date: "2026-07-15" }));
      await app.request("/api/finance/transactions", authed(userB, "POST", { type: "expense", amount: 200, category_id: categoryB.id, date: "2026-07-15" }));

      const listA = (await (await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(userA))).json()) as {
        transactions: unknown[];
      };
      expect(listA.transactions).toHaveLength(1);
    });
  });

  describe("summary", () => {
    it("splits totals per currency and computes net", async () => {
      const { app } = ctx;
      const token = await validToken();
      const foodCategory = await seedCategory(app, token, { name: "餐飲", type: "expense" });
      const salaryCategory = await seedCategory(app, token, { name: "薪資", type: "income" });

      await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 300, category_id: foodCategory.id, date: "2026-07-05" }));
      await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 1000, currency: "USD", category_id: foodCategory.id, date: "2026-07-06" }),
      );
      await app.request("/api/finance/transactions", authed(token, "POST", { type: "income", amount: 50000, category_id: salaryCategory.id, date: "2026-07-01" }));

      const res = await app.request("/api/finance/summary?month=2026-07", authed(token));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { month: string; totals: unknown[]; by_category: unknown[] };
      expect(body.month).toBe("2026-07");
      expect(body.totals).toEqual(
        expect.arrayContaining([
          { currency: "TWD", expense: 300, income: 50000, net: 49700 },
          { currency: "USD", expense: 1000, income: 0, net: -1000 },
        ]),
      );
    });

    it("returns empty totals/by_category for a month with no transactions, and excludes other users", async () => {
      const { app } = ctx;
      const token = await validToken();
      const otherToken = await validToken("uid-other");
      const category = await seedCategory(app, otherToken);
      await app.request("/api/finance/transactions", authed(otherToken, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }));

      const res = await app.request("/api/finance/summary?month=2026-07", authed(token));
      expect(await res.json()).toEqual({ month: "2026-07", totals: [], by_category: [] });
    });
  });

  describe("budgets", () => {
    it("PUT creates then updates (upsert) an overall budget, GET reports its progress", async () => {
      const { app } = ctx;
      const token = await validToken();

      const created = await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 20000 }));
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as Record<string, unknown>;
      expect(createdBody).toMatchObject({ category_id: null, amount: 20000 });

      const updated = await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 25000 }));
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ id: createdBody.id, category_id: null, amount: 25000 });

      const progress = await app.request("/api/finance/budgets?month=2026-07", authed(token));
      expect(progress.status).toBe(200);
      const progressBody = (await progress.json()) as { month: string; budgets: { id: string; amount: number; spent: number; remaining: number }[] };
      expect(progressBody.month).toBe("2026-07");
      expect(progressBody.budgets).toEqual([{ id: createdBody.id, category_id: null, amount: 25000, spent: 0, remaining: 25000, percent: 0 }]);
    });

    it("PUT creates a category budget and GET splits overall vs category spent, excluding a USD transaction", async () => {
      const { app } = ctx;
      const token = await validToken();
      const food = await seedCategory(app, token, { name: "餐飲" });
      const transit = await seedCategory(app, token, { name: "交通" });

      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 10000 }));
      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: food.id, amount: 3000 }));

      await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 2500, category_id: food.id, date: "2026-07-10" }));
      await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 1000, category_id: transit.id, date: "2026-07-11" }));
      await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 999, currency: "USD", category_id: food.id, date: "2026-07-12" }));

      const progress = (await (await app.request("/api/finance/budgets?month=2026-07", authed(token))).json()) as {
        budgets: { category_id: string | null; spent: number }[];
      };
      const overall = progress.budgets.find((b) => b.category_id === null);
      const foodProgress = progress.budgets.find((b) => b.category_id === food.id);
      expect(overall?.spent).toBe(3500);
      expect(foodProgress?.spent).toBe(2500);
    });

    it("PUT rejects amount <= 0 (400) and an unknown month on GET (400)", async () => {
      const { app } = ctx;
      const token = await validToken();
      expect((await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 0 }))).status).toBe(400);
      expect((await app.request("/api/finance/budgets?month=not-a-month", authed(token))).status).toBe(400);
    });

    it("PUT rejects an income category (400), an archived category (400), and another user's category (404)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const income = await seedCategory(app, token, { name: "薪資", type: "income" });
      const archivable = await seedCategory(app, token, { name: "娛樂" });
      await app.request(`/api/finance/categories/${archivable.id}`, authed(token, "PUT", { archived: true }));
      const otherToken = await validToken("uid-other");
      const otherCategory = await seedCategory(app, otherToken);

      expect((await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: income.id, amount: 1000 }))).status).toBe(400);
      expect((await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: archivable.id, amount: 1000 }))).status).toBe(400);
      expect((await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: otherCategory.id, amount: 1000 }))).status).toBe(404);
    });

    it("DELETE removes an owned budget (200) and 404s for another user's or an unknown budget", async () => {
      const { app } = ctx;
      const owner = await validToken("uid-owner");
      const other = await validToken("uid-other");
      const created = (await (await app.request("/api/finance/budgets", authed(owner, "PUT", { category_id: null, amount: 1000 }))).json()) as { id: string };

      expect((await app.request(`/api/finance/budgets/${created.id}`, authed(other, "DELETE"))).status).toBe(404);
      expect((await app.request("/api/finance/budgets/nope", authed(owner, "DELETE"))).status).toBe(404);

      const deleteRes = await app.request(`/api/finance/budgets/${created.id}`, authed(owner, "DELETE"));
      expect(deleteRes.status).toBe(200);

      const progress = (await (await app.request("/api/finance/budgets?month=2026-07", authed(owner))).json()) as { budgets: unknown[] };
      expect(progress.budgets).toEqual([]);
    });

    it("crossing 80% on a TWD expense POST records and pushes a budget alert", async () => {
      const { app, budgetAlertNotifier } = ctx;
      const token = await validToken();
      const food = await seedCategory(app, token, { name: "餐飲" });
      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: food.id, amount: 1000 }));

      const res = await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 900, category_id: food.id, date: "2026-07-01" }));
      expect(res.status).toBe(200); // the transaction write succeeds regardless of the alert side effect

      expect(budgetAlertNotifier.messages).toHaveLength(1);
      expect(budgetAlertNotifier.messages[0].message).toEqual({ title: "預算提醒", body: "7月餐飲支出已達預算 8 成" });
    });
  });
});
