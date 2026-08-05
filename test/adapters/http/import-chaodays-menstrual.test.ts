import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { ChaodaysClient, ChaodaysMenstrualRecord, ChaodaysSession } from "../../../src/contexts/health/domain/chaodays-client";
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../../src/contexts/health/domain/chaodays-client";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
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

class InMemoryMenstrualRepository implements MenstrualRepository {
  private periods: MenstrualPeriod[] = [];
  private nextId = 1;

  async add(input: AddPeriodInput): Promise<MenstrualPeriod> {
    const period: MenstrualPeriod = { id: `period-${this.nextId++}`, ...input };
    this.periods.push(period);
    return period;
  }

  async listByUser(userId: string): Promise<MenstrualPeriod[]> {
    return this.periods.filter((p) => p.userId === userId);
  }

  async update(_userId: string, _id: string, _patch: UpdatePeriodPatch): Promise<MenstrualPeriod | null> {
    return notImplemented();
  }

  async delete(_userId: string, _id: string): Promise<boolean> {
    return notImplemented();
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "chaodays-uid" };

class StubChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysMenstrualRecord[] = [];
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

  fetchDietRecords(): never {
    throw new Error("not used in this test");
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

  async fetchMenstruals(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysMenstrualRecord[] }> {
    this.fetchArgs = { from, to };
    return { session, records: this.records };
  }
}

function buildApp() {
  const menstrualRepository = new InMemoryMenstrualRepository();
  const chaodaysClient = new StubChaodaysClient();
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
    chaodaysClient,
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
  return { app, menstrualRepository, chaodaysClient };
}

const VALID_BODY = {
  chaodays_uid: "chaodays-uid",
  chaodays_password: "chaodays-pw",
  start_date: "2026-07-01",
  end_date: "2026-07-31",
};

describe("POST /api/import/chaodays/menstrual", () => {
  it("requires auth", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/import/chaodays/menstrual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(401);
  });

  it("imports the periods and returns the summary", async () => {
    const { app, menstrualRepository, chaodaysClient } = buildApp();
    const token = await validToken();
    chaodaysClient.records = [
      { id: 1, startDate: "2026-07-05", endDate: "2026-07-09" },
      { id: 2, startDate: "2026-07-20", endDate: null },
    ];

    const res = await app.request("/api/import/chaodays/menstrual", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 1, skipped: 1, from: "2026-07-01", to: "2026-07-31" });
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchArgs).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(await menstrualRepository.listByUser("user-1")).toEqual([
      { id: "period-1", userId: "user-1", startDate: "2026-07-05", endDate: "2026-07-09" },
    ]);
  });

  it.each([
    ["chaodays_uid missing", { ...VALID_BODY, chaodays_uid: undefined }],
    ["chaodays_password missing", { ...VALID_BODY, chaodays_password: "" }],
    ["start_date invalid", { ...VALID_BODY, start_date: "not-a-date" }],
    ["end_date missing", { ...VALID_BODY, end_date: undefined }],
    ["start_date after end_date", { ...VALID_BODY, start_date: "2026-07-10", end_date: "2026-07-01" }],
  ])("rejects %s, as 400", async (_desc, body) => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/import/chaodays/menstrual", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(400);
  });

  it("maps a chaodays auth failure to 400 chaodays_auth_failed", async () => {
    const { app, chaodaysClient } = buildApp();
    const token = await validToken();
    chaodaysClient.signInError = new ChaodaysAuthError();

    const res = await app.request("/api/import/chaodays/menstrual", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "chaodays_auth_failed" });
  });

  it("maps a chaodays upstream failure to 502 chaodays_unavailable", async () => {
    const { app, chaodaysClient } = buildApp();
    const token = await validToken();
    chaodaysClient.signInError = new ChaodaysUpstreamError();

    const res = await app.request("/api/import/chaodays/menstrual", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "chaodays_unavailable" });
  });
});
