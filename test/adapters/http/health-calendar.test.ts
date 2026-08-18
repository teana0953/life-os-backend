import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { DailyTarget } from "../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { HealthCalendarRepository } from "../../../src/contexts/health/domain/health-calendar-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
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
import { stubModelClient } from "./assistant-stubs";

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}

const stubFoodDictionaryRepository = { search: notImplemented, findById: notImplemented, createCustom: notImplemented, favorite: notImplemented, unfavorite: notImplemented, listFavorites: notImplemented, findSharedById: notImplemented, createShared: notImplemented, updateSharedById: notImplemented } as unknown as FoodDictionaryRepository;
const stubWaterRepository = { getIntake: notImplemented, addIntake: notImplemented, getTarget: notImplemented, getLatestTargetOnOrBefore: notImplemented, setTarget: notImplemented } as unknown as WaterRepository;
const stubBowelRepository = { get: notImplemented, set: notImplemented } as unknown as BowelRepository;
const stubExerciseRepository = { addEntry: notImplemented, listByDay: notImplemented, deleteEntry: notImplemented } as unknown as ExerciseRepository;
const stubMenstrualRepository = { add: notImplemented, listByUser: notImplemented, update: notImplemented, delete: notImplemented } as unknown as MenstrualRepository;
const stubVitalsRepository = { get: notImplemented, set: notImplemented, getLatestWeight: notImplemented, getEarliestWeight: notImplemented, getWeightDayCount: notImplemented, listRange: notImplemented } as unknown as VitalsRepository;
const stubBodyProfileRepository = { get: notImplemented, upsert: notImplemented } as unknown as BodyProfileRepository;
const stubChaodaysClient = { signIn: notImplemented, fetchWeightRecords: notImplemented } as unknown as ChaodaysClient;

// No diet targets → diet adherence is 0; only meals/calendar matter here.
const stubDailyTargetRepository: DailyTargetRepository = {
  get: async () => null,
  getLatestOnOrBefore: async (): Promise<DailyTarget | null> => null,
  listInRange: async () => [],
  set: notImplemented,
  setMany: notImplemented,
};
const stubMealRepository = { upsertMealWithItems: notImplemented, listMealsByDay: async () => [], listMealsInRange: async () => [], listLoggedDays: notImplemented, updateMealTime: notImplemented, deleteMeal: notImplemented, updateItem: notImplemented, deleteItem: notImplemented } as unknown as MealRepository;

class FakeCalendarRepository implements HealthCalendarRepository {
  constructor(private readonly days: string[]) {}
  async listLoggedDays(_userId: string, from: string, to: string): Promise<string[]> {
    return this.days.filter((d) => d >= from && d <= to).sort();
  }
}

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
  private byUid = new Map<string, User>();
  private nextId = 1;
  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const existing = this.byUid.get(input.firebaseUid);
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
    this.byUid.set(input.firebaseUid, user);
    return user;
  }
  async getById(userId: string): Promise<User | null> {
    for (const user of this.byUid.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }

  async updateTimezone(userId: string, timezone: string): Promise<void> {
    for (const user of this.byUid.values()) {
      if (user.id === userId) {
        user.timezone = timezone;
        return;
      }
    }
  }
}

function buildApp(days: string[] = []) {
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
    healthCalendarRepository: new FakeCalendarRepository(days),
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
    pushDeliveryRepository: {
      registerSent: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      markAcked: async () => {
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
    installmentPlanRepository: {
      createWithInstallments: notImplemented,
      findById: notImplemented,
      listInstallments: notImplemented,
      rewriteUpcoming: notImplemented,
      settle: notImplemented,
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
    modelClient: stubModelClient,
    ping: async () => {},
  });
  return { app };
}

function authed(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

describe("health-calendar HTTP route", () => {
  it("returns the month summary for a completed past month", async () => {
    // 2020-01 is safely past → fully elapsed (31 days) regardless of the clock.
    const { app } = buildApp(["2020-01-05", "2020-01-10"]);
    const token = await validToken();

    const res = await app.request("/api/health-calendar?month=2020-01", authed(token));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      year: 2020,
      month: 1,
      logged_days: ["2020-01-05", "2020-01-10"],
      days_elapsed: 31,
      logging_rate: 6, // round(100 * 2 / 31)
      diet_adherence_rate: 0, // no targets set
    });
  });

  it("uses a client-supplied today to bound the current month", async () => {
    // With today=2026-07-05, month 2026-07 has 5 elapsed days regardless of the clock.
    const { app } = buildApp(["2026-07-02"]);
    const token = await validToken();

    const res = await app.request("/api/health-calendar?month=2026-07&today=2026-07-05", authed(token));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { days_elapsed: number; logging_rate: number };
    expect(body.days_elapsed).toBe(5);
    expect(body.logging_rate).toBe(20); // round(100 * 1 / 5)
  });

  it("rejects a malformed today with 400", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const res = await app.request("/api/health-calendar?month=2026-07&today=07-05-2026", authed(token));
    expect(res.status).toBe(400);
  });

  it("rejects a missing month with 400", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const res = await app.request("/api/health-calendar", authed(token));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed month with 400", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const res = await app.request("/api/health-calendar?month=2026-13", authed(token));
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/health-calendar?month=2020-01");
    expect(res.status).toBe(401);
  });
});
