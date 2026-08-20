import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { createApp } from "../../../src/adapters/http/app";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { FoodItem } from "../../../src/contexts/health/domain/food-item";
import type { HealthCalendarRepository } from "../../../src/contexts/health/domain/health-calendar-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { CareItemRepository } from "../../../src/contexts/notifications/domain/care-item";
import type { CareLogRepository } from "../../../src/contexts/notifications/domain/care-log";
import type { FinanceBudgetRepository } from "../../../src/contexts/finance/domain/finance-budget-repository";
import type { NetWorthRepository } from "../../../src/contexts/finance/domain/networth-repository";
import type { BalanceRepository } from "../../../src/contexts/split/domain/balance-repository";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import { stubModelClient } from "./assistant-stubs";
import { stubFriendInviteRepository, stubFriendshipRepository } from "./social-stubs";
import {
  stubExpenseGroupRepository,
  stubSettlementRepository,
  stubSplitActivityRepository,
  stubSplitExpenseRepository,
  stubSplitFriendChecker,
  stubSplitSpendingRepository,
} from "./split-stubs";

/**
 * Shared harness for the two batch-read endpoints' suites. The repositories
 * here return real, non-empty data on purpose: an isolation test that asserts
 * only the status code, or that compares against empty fakes, passes against a
 * handler returning nothing at all.
 */

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}

export const PROJECT_ID = "life-os-test";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KEY_ID = "test-key-1";

let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;

/** Call once from `beforeAll`; generates the key pair the fake tokens are signed with. */
export async function initBatchAuth(): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  signingKey = privateKey;
  const jwk = await exportJWK(publicKey);
  jwk.kid = KEY_ID;
  jwk.alg = "RS256";
  jwk.use = "sig";
  const keySet: JSONWebKeySet = { keys: [jwk] };
  jwks = createLocalJWKSet(keySet);
}

export async function validToken(uid = "uid-1"): Promise<string> {
  return new SignJWT({ email: "alice@example.com", name: "Alice" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setSubject(uid)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(PROJECT_ID)
    .setExpirationTime("1h")
    .sign(signingKey);
}

export const FAVORITE_FOOD_ITEM: FoodItem = {
  id: "food-1",
  ownerUserId: null,
  name: "白飯",
  carbG: 40,
  proteinG: 3,
  fatG: 0.5,
  sugarG: 0,
  fiberG: 0.5,
  kcal: 180,
  staple: 1,
  meat: 0,
  fruit: 0,
  veg: 0,
  baseAmount: 100,
  measureUnit: "g",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

export const CARRIED_DAILY_TARGET = {
  id: "target-1",
  userId: "user-1",
  day: "2026-08-01",
  baseStaple: 3,
  baseMeat: 2,
  baseFruit: 1,
  baseVeg: 4,
  bonusStaple: 0,
  bonusMeat: 0,
  bonusFruit: 0,
  bonusVeg: 0,
};

export const TREND_WEIGHT_KG = 68;
export const BASELINE_WEIGHT_KG = 72;
export const HEIGHT_CM = 170;
export const TARGET_WEIGHT_KG = 60;
export const WATER_TARGET_ML = 2000;
export const WATER_TOTAL_ML = 750;
export const LOGGED_CALENDAR_DAY = "2026-08-03";
export const BUDGET_AMOUNT = 12_000;
export const BUDGET_SPENT = 3_000;

/** One recorded repository call: the method's qualified name and the arguments it got. */
export interface RecordedCall {
  name: string;
  args: unknown[];
}

/** Replaces one repository method, keyed `"<repository>.<method>"` (e.g. `"bowel.get"`). */
export type RepositoryOverrides = Record<string, (...args: never[]) => unknown>;

function withRecording<T extends object>(prefix: string, repository: T, calls: RecordedCall[], overrides: RepositoryOverrides): T {
  const recorded: Record<string, unknown> = {};
  for (const [method, value] of Object.entries(repository)) {
    if (typeof value !== "function") {
      recorded[method] = value;
      continue;
    }
    const override = overrides[`${prefix}.${method}`];
    const impl = (override ?? value) as (...args: unknown[]) => unknown;
    recorded[method] = (...args: unknown[]) => {
      calls.push({ name: `${prefix}.${method}`, args });
      return impl(...args);
    };
  }
  return recorded as T;
}

/**
 * An object literal rather than a class instance: the recorder walks own
 * enumerable properties, and a class's methods live on the prototype where it
 * would not see them (every call would then be a missing-method TypeError).
 */
function inMemoryUserRepository(): UserRepository {
  const usersByFirebaseUid = new Map<string, User>();
  let nextId = 1;

  return {
    async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
      const existing = usersByFirebaseUid.get(input.firebaseUid);
      if (existing) return existing;
      const user: User = {
        id: `user-${nextId++}`,
        firebaseUid: input.firebaseUid,
        email: input.email,
        displayName: input.displayName,
        // Fixed, and deliberately not UTC: the care sections resolve the
        // caller's local date from it.
        timezone: "Asia/Taipei",
        isAdmin: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      usersByFirebaseUid.set(input.firebaseUid, user);
      return user;
    },

    async updateTimezone(): Promise<void> {},

    async getById(userId: string): Promise<User | null> {
      for (const user of usersByFirebaseUid.values()) {
        if (user.id === userId) return user;
      }
      return null;
    },
  };
}

/**
 * Builds an app whose read repositories all answer with fixed data, recording
 * every call. `overrides` replaces individual methods — that is how a test
 * makes one section reject (a repository that really throws) or hang (a
 * promise that never settles).
 */
export function buildBatchApp(overrides: RepositoryOverrides = {}) {
  const calls: RecordedCall[] = [];
  const record = <T extends object>(prefix: string, repository: T): T => withRecording(prefix, repository, calls, overrides);

  const userRepository = record<UserRepository>("user", inMemoryUserRepository());

  const bodyProfileRepository = record<BodyProfileRepository>("bodyProfile", {
    get: async () => ({ userId: "user-1", heightCm: HEIGHT_CM, targetWeightKg: TARGET_WEIGHT_KG }),
    upsert: notImplemented,
  });

  const vitalsRepository = record<VitalsRepository>("vitals", {
    get: async (_userId: string, day: string) => ({
      userId: "user-1",
      day,
      weightKg: TREND_WEIGHT_KG,
      bodyFatPct: 22,
      waistCm: 80,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    }),
    set: notImplemented,
    setMany: notImplemented,
    getLatestWeight: async () => TREND_WEIGHT_KG,
    getEarliestWeight: async () => BASELINE_WEIGHT_KG,
    getWeightDayCount: async () => 3,
    listRange: async (_userId: string, _from: string, to: string) => [
      {
        userId: "user-1",
        day: to,
        weightKg: TREND_WEIGHT_KG,
        bodyFatPct: null,
        waistCm: null,
        bpReadings: [],
        glucoseReadings: [],
        spo2Readings: [],
      },
    ],
  });

  const healthCalendarRepository = record<HealthCalendarRepository>("healthCalendar", {
    listLoggedDays: async () => [LOGGED_CALENDAR_DAY],
  });

  const dailyTargetRepository = record<DailyTargetRepository>("dailyTarget", {
    // null on the exact day so the carry-forward path (a second read) runs —
    // the worst case for the query count assertion.
    get: async () => null,
    getLatestOnOrBefore: async () => CARRIED_DAILY_TARGET,
    listInRange: async () => [],
    set: notImplemented,
    setMany: notImplemented,
  });

  const mealRepository = record<MealRepository>("meal", {
    upsertMealWithItems: notImplemented,
    createMeals: notImplemented,
    listMealsByDay: async () => [],
    listMealsInRange: async () => [],
    listLoggedDays: notImplemented,
    updateMealTime: notImplemented,
    deleteMeal: notImplemented,
    updateItem: notImplemented,
    deleteItem: notImplemented,
  });

  const foodDictionaryRepository = record<FoodDictionaryRepository>("foodDictionary", {
    search: notImplemented,
    findById: notImplemented,
    createCustom: notImplemented,
    favorite: notImplemented,
    unfavorite: notImplemented,
    listFavorites: async () => [FAVORITE_FOOD_ITEM],
    findSharedById: notImplemented,
    createShared: notImplemented,
    updateSharedById: notImplemented,
  });

  const waterRepository = record<WaterRepository>("water", {
    getIntake: async (_userId: string, day: string) => ({ userId: "user-1", day, totalMl: WATER_TOTAL_ML }),
    addIntake: notImplemented,
    addIntakeMany: notImplemented,
    listIntakeRange: notImplemented,
    // null on the exact day so the carry-forward read runs (worst case).
    getTarget: async () => null,
    getLatestTargetOnOrBefore: async () => ({ userId: "user-1", day: "2026-08-01", targetMl: WATER_TARGET_ML }),
    listTargetRange: notImplemented,
    setTarget: notImplemented,
    setTargetMany: notImplemented,
  });

  const bowelRepository = record<BowelRepository>("bowel", {
    get: async (_userId: string, day: string) => ({ userId: "user-1", day, count: 2, isNormal: true, note: "ok" }),
    set: notImplemented,
    setMany: notImplemented,
    listRange: notImplemented,
  });

  const exerciseRepository = record<ExerciseRepository>("exercise", {
    addEntry: notImplemented,
    listByDay: async () => [],
    deleteEntry: notImplemented,
  });

  const menstrualRepository = record<MenstrualRepository>("menstrual", {
    add: notImplemented,
    listByUser: async () => [{ id: "period-1", userId: "user-1", startDate: "2026-07-20", endDate: "2026-07-25" }],
    update: notImplemented,
    delete: notImplemented,
  });

  const careItemRepository = record<CareItemRepository>("careItem", {
    create: notImplemented,
    listByUser: async () => [],
    get: notImplemented,
    getByScheduleId: notImplemented,
    update: notImplemented,
    delete: notImplemented,
    listActiveSchedules: notImplemented,
    listActiveSchedulesForUserOn: async () => [],
    decrementStock: notImplemented,
    incrementStock: notImplemented,
  });

  const careLogRepository = record<CareLogRepository>("careLog", {
    upsertIfAbsent: notImplemented,
    getBySlot: notImplemented,
    listByUserAndDate: async () => [],
    listByUserAndDateRange: async () => [],
    upsert: notImplemented,
  });

  const financeBudgetRepository = record<FinanceBudgetRepository>("financeBudget", {
    upsert: notImplemented,
    findByUserAndCategory: notImplemented,
    delete: notImplemented,
    listWithSpent: async () => [
      { budget: { id: "budget-1", userId: "user-1", categoryId: null, amount: BUDGET_AMOUNT }, spent: BUDGET_SPENT },
    ],
    getSpent: notImplemented,
    tryRecordAlert: notImplemented,
  });

  const financeNetWorthRepository = record<NetWorthRepository>("financeNetWorth", {
    listAccounts: notImplemented,
    findAccountById: notImplemented,
    findAccountByUserKindName: notImplemented,
    createAccount: notImplemented,
    updateAccount: notImplemented,
    reorderAccounts: notImplemented,
    insertDefaultAccountsIfMissing: notImplemented,
    upsertSnapshot: notImplemented,
    listMonthValues: async () => [{ accountId: "acct-1", kind: "asset" as const, name: "現金", value: 50_000 }],
    getMonthlyTotals: async () => ({ totalAsset: 50_000, totalLiability: 20_000 }),
    findPreviousSnapshotMonth: async () => null,
    getTrend: notImplemented,
  });

  const splitBalanceRepository = record<BalanceRepository>("splitBalance", {
    balancesForUser: async () => [
      { userId: "user-2", displayName: "Bob", balances: [{ currency: "TWD", amount: 250 }] },
    ],
    balancesForGroup: notImplemented,
  });

  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository,
    foodDictionaryRepository,
    mealRepository,
    dailyTargetRepository,
    waterRepository,
    bowelRepository,
    vitalsRepository,
    exerciseRepository,
    menstrualRepository,
    bodyProfileRepository,
    healthCalendarRepository,
    chaodaysClient: {
      signIn: notImplemented,
      fetchWeightRecords: notImplemented,
      fetchDietRecords: notImplemented,
      fetchWaterRecords: notImplemented,
      fetchDefecationRecords: notImplemented,
      fetchDietMenus: notImplemented,
      fetchMenstruals: notImplemented,
    } satisfies ChaodaysClient,
    pushSubscriptionRepository: {
      upsert: notImplemented,
      listByUser: notImplemented,
      deleteByEndpoint: notImplemented,
    },
    pushDeliveryRepository: { registerSent: notImplemented, markAcked: notImplemented },
    pushSender: { send: notImplemented },
    vapidPublicKey: "",
    careItemRepository,
    careLogRepository,
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
    financeBudgetRepository,
    financeNetWorthRepository,
    installmentPlanRepository: {
      createWithInstallments: notImplemented,
      findById: notImplemented,
      listInstallments: notImplemented,
      rewriteUpcoming: notImplemented,
      settle: notImplemented,
    },
    budgetAlertNotifier: { notify: notImplemented },
    friendshipRepository: stubFriendshipRepository,
    friendInviteRepository: stubFriendInviteRepository,
    expenseGroupRepository: stubExpenseGroupRepository,
    splitExpenseRepository: stubSplitExpenseRepository,
    splitBalanceRepository,
    splitFriendChecker: stubSplitFriendChecker,
    splitSettlementRepository: stubSettlementRepository,
    splitActivityRepository: stubSplitActivityRepository,
    splitSpendingRepository: stubSplitSpendingRepository,
    modelClient: stubModelClient,
    ping: async () => {},
  });

  return { app, calls };
}

/** The arguments of the single call to `name`; fails loudly when it ran a different number of times. */
export function argsOf(calls: RecordedCall[], name: string): unknown[] {
  const matching = calls.filter((call) => call.name === name);
  if (matching.length !== 1) {
    throw new Error(`expected exactly one call to ${name}, saw ${matching.length}`);
  }
  return matching[0].args;
}

/** A repository method that never settles — the only fake shape that can exercise the section timeout. */
export function neverSettles(): () => Promise<never> {
  return () => new Promise<never>(() => {});
}

/** A repository method that really rejects (not one that returns empty), for the isolation tests. */
export function rejectsWith(message: string): () => Promise<never> {
  return async () => {
    throw new Error(message);
  };
}
