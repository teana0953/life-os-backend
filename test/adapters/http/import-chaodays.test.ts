import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { ChaodaysClient, ChaodaysSession, ChaodaysWeightRecord } from "../../../src/contexts/health/domain/chaodays-client";
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../../src/contexts/health/domain/chaodays-client";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { VitalsRecord } from "../../../src/contexts/health/domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";

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
  getTarget: notImplemented,
  getLatestTargetOnOrBefore: notImplemented,
  setTarget: notImplemented,
};
const stubBowelRepository: BowelRepository = {
  get: notImplemented,
  set: notImplemented,
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

class InMemoryVitalsRepository implements VitalsRepository {
  private byUserDay = new Map<string, VitalsRecord>();

  seed(record: VitalsRecord) {
    this.byUserDay.set(`${record.userId}:${record.day}`, record);
  }

  async get(userId: string, day: string): Promise<VitalsRecord | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetVitalsInput): Promise<VitalsRecord> {
    const record: VitalsRecord = {
      userId: input.userId,
      day: input.day,
      weightKg: input.weightKg,
      bodyFatPct: input.bodyFatPct,
      bpReadings: input.bpReadings,
      glucoseReadings: input.glucoseReadings,
      spo2Readings: input.spo2Readings,
    };
    this.byUserDay.set(`${input.userId}:${input.day}`, record);
    return record;
  }

  async setMany(): Promise<void> {
    throw new Error("not used in this test");
  }

  async getLatestWeight(): Promise<number | null> {
    throw new Error("not used in this test");
  }

  async getEarliestWeight(): Promise<number | null> {
    throw new Error("not used in this test");
  }

  async getWeightDayCount(): Promise<number> {
    throw new Error("not used in this test");
  }

  async listRange(): Promise<VitalsRecord[]> {
    throw new Error("not used in this test");
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "chaodays-uid" };

class StubChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysWeightRecord[] = [];
  signInArgs: { uid: string; password: string } | null = null;
  fetchArgs: { from: string; to: string } | null = null;

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    this.signInArgs = { uid, password };
    if (this.signInError) throw this.signInError;
    return SESSION;
  }

  async fetchWeightRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWeightRecord[] }> {
    this.fetchArgs = { from, to };
    return { session, records: this.records };
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
}

function buildApp() {
  const vitalsRepository = new InMemoryVitalsRepository();
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
    vitalsRepository,
    exerciseRepository: stubExerciseRepository,
    menstrualRepository: stubMenstrualRepository,
    bodyProfileRepository: stubBodyProfileRepository,
    healthCalendarRepository: { listLoggedDays: async () => [] },
    chaodaysClient,
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
  return { app, vitalsRepository, chaodaysClient };
}

const VALID_BODY = {
  chaodays_uid: "chaodays-uid",
  chaodays_password: "chaodays-pw",
  start_date: "2026-07-01",
  end_date: "2026-07-02",
};

describe("POST /api/import/chaodays/weight", () => {
  it("requires auth", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/import/chaodays/weight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(401);
  });

  it("imports weight records and returns the summary", async () => {
    const { app, vitalsRepository, chaodaysClient } = buildApp();
    const token = await validToken();
    chaodaysClient.records = [
      { date: "2026-07-01", weight: 65.5, bodyFatPct: 22.1 },
      { date: "2026-07-02", weight: null, bodyFatPct: null },
    ];

    const res = await app.request("/api/import/chaodays/weight", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 1, skipped: 1, from: "2026-07-01", to: "2026-07-02" });
    // The snake_case body threads through to the client as the right fields.
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchArgs).toEqual({ from: "2026-07-01", to: "2026-07-02" });
    const record = await vitalsRepository.get("user-1", "2026-07-01");
    expect(record?.weightKg).toBe(65.5);
    expect(record?.bodyFatPct).toBe(22.1);
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

    const res = await app.request("/api/import/chaodays/weight", {
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

    const res = await app.request("/api/import/chaodays/weight", {
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

    const res = await app.request("/api/import/chaodays/weight", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "chaodays_unavailable" });
  });
});
