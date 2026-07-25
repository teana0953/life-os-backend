import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelLog } from "../../../src/contexts/health/domain/bowel";
import type { SetBowelLogInput, BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
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
};
const stubFoodDictionaryRepository: FoodDictionaryRepository = {
  search: notImplemented,
  findById: notImplemented,
  createCustom: notImplemented,
  favorite: notImplemented,
  unfavorite: notImplemented,
  listFavorites: notImplemented,
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
};
const stubWaterRepository: WaterRepository = {
  getIntake: notImplemented,
  addIntake: notImplemented,
  addIntakeMany: notImplemented,
  listIntakeRange: notImplemented,
  getTarget: notImplemented,
  getLatestTargetOnOrBefore: notImplemented,
  setTarget: notImplemented,
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
const stubMenstrualRepository: MenstrualRepository = {
  add: notImplemented,
  listByUser: notImplemented,
  update: notImplemented,
  delete: notImplemented,
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

class InMemoryBowelRepository implements BowelRepository {
  private byUserDay = new Map<string, BowelLog>();

  async get(userId: string, day: string): Promise<BowelLog | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetBowelLogInput): Promise<BowelLog> {
    const log: BowelLog = {
      userId: input.userId,
      day: input.day,
      count: input.count,
      isNormal: input.isNormal,
      note: input.note,
    };
    this.byUserDay.set(`${input.userId}:${input.day}`, log);
    return log;
  }

  async setMany(rows: SetBowelLogInput[]): Promise<void> {
    for (const row of rows) {
      await this.set(row);
    }
  }

  async listRange(userId: string, from: string, to: string): Promise<BowelLog[]> {
    return [...this.byUserDay.values()].filter((r) => r.userId === userId && r.day >= from && r.day <= to);
  }
}

function buildApp() {
  const bowelRepository = new InMemoryBowelRepository();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(),
    foodDictionaryRepository: stubFoodDictionaryRepository,
    mealRepository: stubMealRepository,
    dailyTargetRepository: stubDailyTargetRepository,
    waterRepository: stubWaterRepository,
    bowelRepository,
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
      create: notImplemented,
      listByUser: notImplemented,
      get: notImplemented,
      getByScheduleId: notImplemented,
      update: notImplemented,
      delete: notImplemented,
      listActiveSchedules: notImplemented,
      listActiveSchedulesForUserOn: notImplemented,
      decrementStock: notImplemented,
    },
    careLogRepository: {
      upsertIfAbsent: notImplemented,
      getBySlot: notImplemented,
      listByUserAndDate: notImplemented,
      listByUserAndDateRange: notImplemented,
    },
    vapidPublicKey: "",
    ping: async () => {},
  });
  return { app, bowelRepository };
}

describe("bowel HTTP routes", () => {
  it("requires auth for GET /api/bowel", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/bowel?day=2026-07-18");

    expect(res.status).toBe(401);
  });

  it("requires auth for PUT /api/bowel", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/bowel", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", count: 2, is_normal: true, note: "fine" }),
    });

    expect(res.status).toBe(401);
  });

  it("reads empty defaults for an unrecorded day", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/bowel?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: "2026-07-18", count: 0, is_normal: null, note: "" });
  });

  it("upserts a day's record and returns it", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const put = await app.request("/api/bowel", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", count: 2, is_normal: true, note: "fine" }),
    });

    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ day: "2026-07-18", count: 2, is_normal: true, note: "fine" });

    const get = await app.request("/api/bowel?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });
    expect(await get.json()).toEqual({ day: "2026-07-18", count: 2, is_normal: true, note: "fine" });
  });

  it("allows a null flag and an empty note", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/bowel", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", count: 1 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: "2026-07-18", count: 1, is_normal: null, note: "" });
  });

  it("rejects GET /api/bowel with a missing day, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/bowel", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  it("rejects PUT /api/bowel with a non-numeric count, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/bowel", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", count: "abc" }),
    });

    expect(res.status).toBe(400);
  });
});
