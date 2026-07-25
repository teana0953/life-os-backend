import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { VitalsRecord } from "../../../src/contexts/health/domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { BodyProfile } from "../../../src/contexts/health/domain/body-profile";
import type {
  BodyProfileRepository,
  UpdateBodyProfilePatch,
} from "../../../src/contexts/health/domain/body-profile-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
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

class InMemoryBodyProfileRepository implements BodyProfileRepository {
  private byUser = new Map<string, BodyProfile>();

  async get(userId: string): Promise<BodyProfile | null> {
    return this.byUser.get(userId) ?? null;
  }

  async upsert(userId: string, patch: UpdateBodyProfilePatch): Promise<BodyProfile> {
    const current = this.byUser.get(userId) ?? { userId, heightCm: null, targetWeightKg: null };
    if (patch.heightCm === undefined && patch.targetWeightKg === undefined) return current;
    const next: BodyProfile = {
      userId,
      heightCm: patch.heightCm !== undefined ? patch.heightCm : current.heightCm,
      targetWeightKg: patch.targetWeightKg !== undefined ? patch.targetWeightKg : current.targetWeightKg,
    };
    this.byUser.set(userId, next);
    return next;
  }
}

class InMemoryVitalsRepository implements VitalsRepository {
  private byUserDay = new Map<string, VitalsRecord>();

  async get(userId: string, day: string): Promise<VitalsRecord | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetVitalsInput): Promise<VitalsRecord> {
    const record: VitalsRecord = { ...input };
    this.byUserDay.set(`${input.userId}:${input.day}`, record);
    return record;
  }

  async setMany(): Promise<void> {
    throw new Error("not used in this test");
  }

  /** Test helper: seed a weight for a user on a day. */
  seedWeight(userId: string, day: string, weightKg: number) {
    this.byUserDay.set(`${userId}:${day}`, {
      userId,
      day,
      weightKg,
      bodyFatPct: null,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });
  }

  async getLatestWeight(userId: string): Promise<number | null> {
    return this.extreme(userId, "latest");
  }
  async getEarliestWeight(userId: string): Promise<number | null> {
    return this.extreme(userId, "earliest");
  }
  async getWeightDayCount(userId: string): Promise<number> {
    return [...this.byUserDay.values()].filter((r) => r.userId === userId && r.weightKg !== null).length;
  }
  private extreme(userId: string, which: "latest" | "earliest"): number | null {
    const withWeight = [...this.byUserDay.values()].filter((r) => r.userId === userId && r.weightKg !== null);
    if (withWeight.length === 0) return null;
    withWeight.sort((a, b) => a.day.localeCompare(b.day));
    return (which === "latest" ? withWeight[withWeight.length - 1] : withWeight[0]).weightKg;
  }

  async listRange(userId: string, from: string, to: string): Promise<VitalsRecord[]> {
    return [...this.byUserDay.values()]
      .filter((r) => r.userId === userId && r.day >= from && r.day <= to)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
}

function buildApp() {
  const bodyProfileRepository = new InMemoryBodyProfileRepository();
  const vitalsRepository = new InMemoryVitalsRepository();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(),
    foodDictionaryRepository: stubFoodDictionaryRepository,
    mealRepository: stubMealRepository,
    dailyTargetRepository: stubDailyTargetRepository,
    waterRepository: stubWaterRepository,
    bowelRepository: stubBowelRepository,
    vitalsRepository,
    exerciseRepository: stubExerciseRepository,
    menstrualRepository: stubMenstrualRepository,
    bodyProfileRepository,
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
    vapidPublicKey: "",
    ping: async () => {},
  });
  return { app, bodyProfileRepository, vitalsRepository };
}

function authed(token: string, method = "GET", body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return init;
}

describe("body-profile HTTP routes", () => {
  it("requires auth for every endpoint", async () => {
    const { app } = buildApp();
    expect((await app.request("/api/body-profile")).status).toBe(401);
    expect((await app.request("/api/body-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/weight-goal")).status).toBe(401);
  });

  it("GET returns nulls for an unset profile", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const res = await app.request("/api/body-profile", authed(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ height_cm: null, target_weight_kg: null });
  });

  it("PUT sets height and target weight, GET returns them", async () => {
    const { app } = buildApp();
    const token = await validToken();
    const put = await app.request("/api/body-profile", authed(token, "PUT", { height_cm: 165, target_weight_kg: 51 }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ height_cm: 165, target_weight_kg: 51 });
    const get = await app.request("/api/body-profile", authed(token));
    expect(await get.json()).toEqual({ height_cm: 165, target_weight_kg: 51 });
  });

  it("PUT of only target_weight_kg leaves the stored height unchanged", async () => {
    const { app } = buildApp();
    const token = await validToken();
    await app.request("/api/body-profile", authed(token, "PUT", { height_cm: 165, target_weight_kg: 55 }));
    const res = await app.request("/api/body-profile", authed(token, "PUT", { target_weight_kg: 51 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ height_cm: 165, target_weight_kg: 51 });
  });

  it("PUT with an empty body is a no-op that leaves the profile unchanged", async () => {
    const { app } = buildApp();
    const token = await validToken();
    // On an unset profile: no-op returns the nulls, without inserting a bare row.
    const first = await app.request("/api/body-profile", authed(token, "PUT", {}));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ height_cm: null, target_weight_kg: null });
    // After setting: an empty PUT leaves the stored values untouched.
    await app.request("/api/body-profile", authed(token, "PUT", { height_cm: 165, target_weight_kg: 51 }));
    const res = await app.request("/api/body-profile", authed(token, "PUT", {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ height_cm: 165, target_weight_kg: 51 });
  });

  it.each([
    ["a negative height", { height_cm: -1 }],
    ["a zero target weight", { target_weight_kg: 0 }],
    ["a non-numeric height", { height_cm: "tall" }],
    ["an object target weight", { target_weight_kg: {} }],
  ])("PUT rejects %s as 400 and leaves the stored profile unchanged", async (_desc, patch) => {
    const { app } = buildApp();
    const token = await validToken();
    await app.request("/api/body-profile", authed(token, "PUT", { height_cm: 165, target_weight_kg: 51 }));
    const res = await app.request("/api/body-profile", authed(token, "PUT", patch));
    expect(res.status).toBe(400);
    const get = await app.request("/api/body-profile", authed(token));
    expect(await get.json()).toEqual({ height_cm: 165, target_weight_kg: 51 });
  });

  it("GET /api/weight-goal returns the full derived overview", async () => {
    const { app, vitalsRepository } = buildApp();
    const token = await validToken();
    // resolve the user id (uid-1 → user-1) by making an authed call first.
    await app.request("/api/body-profile", authed(token, "PUT", { height_cm: 165, target_weight_kg: 51 }));
    vitalsRepository.seedWeight("user-1", "2026-05-01", 55);
    vitalsRepository.seedWeight("user-1", "2026-07-01", 52);

    const res = await app.request("/api/weight-goal", authed(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      height_cm: 165,
      target_weight_kg: 51,
      current_weight_kg: 52,
      remaining_kg: 1,
      achievement_rate: 75,
      bmi: 19.1,
    });
  });
});
