import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
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

  async setTarget(input: SetWaterTargetInput): Promise<WaterTarget> {
    const target: WaterTarget = { userId: input.userId, day: input.day, targetMl: input.targetMl };
    this.targetByUserDay.set(`${input.userId}:${input.day}`, target);
    return target;
  }
}

function buildApp() {
  const waterRepository = new InMemoryWaterRepository();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(),
    foodDictionaryRepository: stubFoodDictionaryRepository,
    mealRepository: stubMealRepository,
    dailyTargetRepository: stubDailyTargetRepository,
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
      create: notImplemented,
      listByUser: notImplemented,
      get: notImplemented,
      getByScheduleId: notImplemented,
      update: notImplemented,
      delete: notImplemented,
      listActiveSchedules: notImplemented,
      decrementStock: notImplemented,
    },
    careLogRepository: {
      upsertIfAbsent: notImplemented,
      getBySlot: notImplemented,
    },
    vapidPublicKey: "",
    ping: async () => {},
  });
  return { app, waterRepository };
}

describe("water HTTP routes", () => {
  it("requires auth for GET /api/water", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/water?day=2026-07-18");

    expect(res.status).toBe(401);
  });

  it("requires auth for POST /api/water", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/water", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", add_ml: 250 }),
    });

    expect(res.status).toBe(401);
  });

  it("requires auth for PUT /api/water/target", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/water/target", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", target_ml: 2000 }),
    });

    expect(res.status).toBe(401);
  });

  it("reads a day's total, resolved target, and remaining", async () => {
    const { app } = buildApp();
    const token = await validToken();

    await app.request("/api/water/target", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", target_ml: 2000 }),
    });
    await app.request("/api/water", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", add_ml: 750 }),
    });

    const res = await app.request("/api/water?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: "2026-07-18", total_ml: 750, target_ml: 2000, remaining_ml: 1250 });
  });

  it("reports a negative remaining when over the target", async () => {
    const { app } = buildApp();
    const token = await validToken();

    await app.request("/api/water/target", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", target_ml: 2000 }),
    });
    await app.request("/api/water", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", add_ml: 2200 }),
    });

    const res = await app.request("/api/water?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    const body = (await res.json()) as { remaining_ml: number };
    expect(body.remaining_ml).toBe(-200);
  });

  it("accumulates the day's total and clamps at 0 on a correction", async () => {
    const { app } = buildApp();
    const token = await validToken();

    await app.request("/api/water", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", add_ml: 200 }),
    });
    const res = await app.request("/api/water", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", add_ml: -500 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: "2026-07-18", total_ml: 0 });
  });

  it("upserts a day's target and returns it", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/water/target", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", target_ml: 2500 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: "2026-07-18", target_ml: 2500 });
  });

  it("rejects GET /api/water with a missing day, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/water", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  it("rejects POST /api/water with a non-numeric add_ml, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/water", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", add_ml: "abc" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects PUT /api/water/target with a non-numeric target_ml, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/water/target", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", target_ml: "abc" }),
    });

    expect(res.status).toBe(400);
  });
});
