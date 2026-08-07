import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { MenstrualPeriod } from "../../../src/contexts/health/domain/menstrual-period";
import type {
  AddPeriodInput,
  MenstrualRepository,
  UpdatePeriodPatch,
} from "../../../src/contexts/health/domain/menstrual-repository";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import { stubFriendInviteRepository, stubFriendshipRepository } from "./social-stubs";
import {
  stubExpenseGroupRepository,
  stubSettlementRepository,
  stubSplitActivityRepository,
  stubSplitBalanceRepository,
  stubSplitExpenseRepository,
  stubSplitFriendChecker,
  stubSplitSpendingRepository,
} from "./split-stubs";

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
const stubBodyProfileRepository: BodyProfileRepository = {
  get: notImplemented,
  upsert: notImplemented,
};
const stubExerciseRepository: ExerciseRepository = {
  addEntry: notImplemented,
  listByDay: notImplemented,
  deleteEntry: notImplemented,
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

class InMemoryMenstrualRepository implements MenstrualRepository {
  periods: MenstrualPeriod[] = [];
  private nextId = 1;

  async add(input: AddPeriodInput): Promise<MenstrualPeriod> {
    const period: MenstrualPeriod = {
      id: `period-${this.nextId++}`,
      userId: input.userId,
      startDate: input.startDate,
      endDate: input.endDate,
    };
    this.periods.push(period);
    return period;
  }

  async listByUser(userId: string): Promise<MenstrualPeriod[]> {
    return this.periods
      .filter((p) => p.userId === userId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  async update(userId: string, id: string, patch: UpdatePeriodPatch): Promise<MenstrualPeriod | null> {
    const period = this.periods.find((p) => p.id === id && p.userId === userId);
    if (!period) return null;
    if ("startDate" in patch && patch.startDate !== undefined) period.startDate = patch.startDate;
    if ("endDate" in patch) period.endDate = patch.endDate ?? null;
    return period;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const idx = this.periods.findIndex((p) => p.id === id && p.userId === userId);
    if (idx === -1) return false;
    this.periods.splice(idx, 1);
    return true;
  }
}

function buildApp() {
  const menstrualRepository = new InMemoryMenstrualRepository();
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
    menstrualRepository,
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
      financeNetWorthRepository: {
        listAccounts: notImplemented,
        findAccountById: notImplemented,
        findAccountByUserKindName: notImplemented,
        createAccount: notImplemented,
        updateAccount: notImplemented,
        reorderAccounts: notImplemented,
        insertDefaultAccountsIfMissing: notImplemented,
        upsertSnapshot: notImplemented,
        listMonthValues: notImplemented,
        getMonthlyTotals: notImplemented,
        findPreviousSnapshotMonth: notImplemented,
        getTrend: notImplemented,
      },
    budgetAlertNotifier: {
      notify: notImplemented,
    },
    vapidPublicKey: "",
    friendshipRepository: stubFriendshipRepository,
    friendInviteRepository: stubFriendInviteRepository,
    expenseGroupRepository: stubExpenseGroupRepository,
    splitExpenseRepository: stubSplitExpenseRepository,
    splitBalanceRepository: stubSplitBalanceRepository,
    splitFriendChecker: stubSplitFriendChecker,
    splitSettlementRepository: stubSettlementRepository,
    splitActivityRepository: stubSplitActivityRepository,
    splitSpendingRepository: stubSplitSpendingRepository,
    ping: async () => {},
  });
  return { app, menstrualRepository };
}

function authed(token: string, method = "GET", body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return init;
}

describe("menstrual HTTP routes", () => {
  it("requires auth for every /api/menstrual endpoint", async () => {
    const { app } = buildApp();
    expect((await app.request("/api/menstrual")).status).toBe(401);
    expect((await app.request("/api/menstrual", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/menstrual/some-id", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/menstrual/some-id", { method: "DELETE" })).status).toBe(401);
  });

  it("returns empty periods, null stats and null last_period for a user with none", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const res = await app.request("/api/menstrual", authed(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      periods: [],
      stats: { average_cycle_days: null, average_period_days: null, predicted_next_start: null },
      last_period: null,
    });
  });

  it("adds a period (open) and returns it", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const res = await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ start_date: "2026-05-01", end_date: null });
    expect(body.id).toBeTruthy();
  });

  it("adds a completed period with an end date", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const res = await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01", end_date: "2026-05-05" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ start_date: "2026-05-01", end_date: "2026-05-05" });
  });

  it("reads the overview with sorted periods and computed stats", async () => {
    const { app } = buildApp();
    const token = await validToken();
    await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-06-26" }));
    await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01", end_date: "2026-05-05" }));
    await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-29" }));

    const res = await app.request("/api/menstrual", authed(token));
    const body = (await res.json()) as {
      periods: { start_date: string; end_date: string | null }[];
      stats: { average_cycle_days: number | null; average_period_days: number | null; predicted_next_start: string | null };
      last_period: { start_date: string } | null;
    };
    expect(body.periods.map((p) => p.start_date)).toEqual(["2026-05-01", "2026-05-29", "2026-06-26"]);
    expect(body.stats).toEqual({ average_cycle_days: 28, average_period_days: 5, predicted_next_start: "2026-07-24" });
    expect(body.last_period?.start_date).toBe("2026-06-26");
  });

  it("rejects a missing start_date on POST as 400", async () => {
    const { app, menstrualRepository } = buildApp();
    const token = await validToken();
    expect((await app.request("/api/menstrual", authed(token, "POST", {}))).status).toBe(400);
    expect((await app.request("/api/menstrual", authed(token, "POST", { start_date: "not-a-date" }))).status).toBe(400);
    expect(menstrualRepository.periods).toHaveLength(0);
  });

  it("rejects an end_date earlier than start_date on POST as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const res = await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-05", end_date: "2026-05-01" }));
    expect(res.status).toBe(400);
  });

  it("PATCH sets an end date, preserving the start date", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const created = (await (await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01" }))).json()) as { id: string };
    const res = await app.request(`/api/menstrual/${created.id}`, authed(token, "PATCH", { end_date: "2026-05-05" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ start_date: "2026-05-01", end_date: "2026-05-05" });
  });

  it("PATCH with only start_date does NOT wipe the stored end_date", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const created = (await (await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01", end_date: "2026-05-05" }))).json()) as { id: string };
    const res = await app.request(`/api/menstrual/${created.id}`, authed(token, "PATCH", { start_date: "2026-05-02" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ start_date: "2026-05-02", end_date: "2026-05-05" });
  });

  it("PATCH with end_date: null clears the end date", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const created = (await (await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01", end_date: "2026-05-05" }))).json()) as { id: string };
    const res = await app.request(`/api/menstrual/${created.id}`, authed(token, "PATCH", { end_date: null }));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ start_date: "2026-05-01", end_date: null });
  });

  it("rejects a non-string, non-null end_date as 400 (POST) without clearing on PATCH", async () => {
    const { app } = buildApp();
    const token = await validToken();
    // POST: a junk end_date value is rejected, not silently treated as "no end".
    expect((await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01", end_date: 0 }))).status).toBe(400);
    // PATCH: a junk end_date must NOT silently clear the stored end date.
    const created = (await (await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01", end_date: "2026-05-05" }))).json()) as { id: string };
    const res = await app.request(`/api/menstrual/${created.id}`, authed(token, "PATCH", { end_date: 0 }));
    expect(res.status).toBe(400);
    // the stored end date is untouched
    const overview = (await (await app.request("/api/menstrual", authed(token, "GET"))).json()) as {
      periods: { id: string; end_date: string | null }[];
    };
    expect(overview.periods.find((p) => p.id === created.id)?.end_date).toBe("2026-05-05");
  });

  it("PATCH rejects a merged end_date earlier than start_date as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const created = (await (await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-05" }))).json()) as { id: string };
    const res = await app.request(`/api/menstrual/${created.id}`, authed(token, "PATCH", { end_date: "2026-05-01" }));
    expect(res.status).toBe(400);
  });

  it("PATCH on another user's / unknown id returns 404 not_found and changes nothing", async () => {
    const { app } = buildApp();
    const owner = await validToken("uid-owner");
    const other = await validToken("uid-other");
    const created = (await (await app.request("/api/menstrual", authed(owner, "POST", { start_date: "2026-05-01" }))).json()) as { id: string };

    const res = await app.request(`/api/menstrual/${created.id}`, authed(other, "PATCH", { end_date: "2026-05-05" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });

    const unknown = await app.request(`/api/menstrual/nope`, authed(owner, "PATCH", { end_date: "2026-05-05" }));
    expect(unknown.status).toBe(404);

    const ownerView = (await (await app.request("/api/menstrual", authed(owner))).json()) as { periods: { end_date: string | null }[] };
    expect(ownerView.periods[0].end_date).toBeNull();
  });

  it("DELETE removes an owned period and reports it", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const created = (await (await app.request("/api/menstrual", authed(token, "POST", { start_date: "2026-05-01" }))).json()) as { id: string };
    const res = await app.request(`/api/menstrual/${created.id}`, authed(token, "DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });

  it("DELETE on another user's id returns {deleted:false} and changes nothing", async () => {
    const { app } = buildApp();
    const owner = await validToken("uid-owner");
    const other = await validToken("uid-other");
    const created = (await (await app.request("/api/menstrual", authed(owner, "POST", { start_date: "2026-05-01" }))).json()) as { id: string };

    const res = await app.request(`/api/menstrual/${created.id}`, authed(other, "DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: false });

    const ownerView = (await (await app.request("/api/menstrual", authed(owner))).json()) as { periods: unknown[] };
    expect(ownerView.periods).toHaveLength(1);
  });
});
