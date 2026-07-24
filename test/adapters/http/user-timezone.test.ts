import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
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
const stubBowelRepository: BowelRepository = {
  get: notImplemented,
  set: notImplemented,
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
  getTarget: notImplemented,
  getLatestTargetOnOrBefore: notImplemented,
  setTarget: notImplemented,
};

const PROJECT_ID = "life-os-test";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KEY_ID = "test-key-1";

let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;

async function validToken(): Promise<string> {
  return new SignJWT({ email: "alice@example.com", name: "Alice" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setSubject("uid-1")
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

  get(firebaseUid: string): User | undefined {
    return this.usersByFirebaseUid.get(firebaseUid);
  }
}

function buildApp() {
  const userRepository = new InMemoryUserRepository();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository,
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
    pushSender: { send: notImplemented },
    reminderScheduleRepository: {
      create: notImplemented,
      listByUser: notImplemented,
      get: notImplemented,
      update: notImplemented,
      delete: notImplemented,
      listActiveAll: notImplemented,
    },
    vapidPublicKey: "",
    ping: async () => {},
  });
  return { app, userRepository };
}

describe("PUT /api/user/timezone", () => {
  it("requires auth", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/user/timezone", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "Asia/Taipei" }),
    });

    expect(res.status).toBe(401);
  });

  it("saves a valid IANA timezone", async () => {
    const { app, userRepository } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/user/timezone", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "America/New_York" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timezone: "America/New_York" });
    expect(userRepository.get("uid-1")?.timezone).toBe("America/New_York");
  });

  it("rejects an invalid IANA timezone, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/user/timezone", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "Not/A_Zone" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a missing timezone, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/user/timezone", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});
